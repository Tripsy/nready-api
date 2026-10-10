import type { NextFunction, Request, Response } from 'express';
import { Configuration } from '@/config/settings.config';
import { getAccountTokenRepository } from '@/features/account/account-token.repository';
import {
	type AuthSession,
	accountTokenService,
} from '@/features/account/account-token.service';
import UserEntity, { UserStatusEnum } from '@/features/user/user.entity';
import { getUserRepository } from '@/features/user/user.repository';
import { getUserPermissionRepository } from '@/features/user-permission/user-permission.repository';
import { runInBackground } from '@/helpers/background.helper';
import { createCurrentDate } from '@/helpers/date.helper';
import {
	compareMetaDataValue,
	tokenMetaData,
} from '@/helpers/meta-data.helper';
import { cacheProvider } from '@/providers/cache.provider';
import type { AuthContextPermissions } from '@/shared/types/express';

export const AuthFailureReason = {
	NO_TOKEN: 'NO_TOKEN',
	INVALID_TOKEN: 'INVALID_TOKEN',
	TOKEN_EXPIRED: 'TOKEN_EXPIRED',
	METADATA_MISMATCH: 'METADATA_MISMATCH',
	USER_NOT_FOUND: 'USER_NOT_FOUND',
	USER_INACTIVE: 'USER_INACTIVE',
	UNAUTHORIZED: 'UNAUTHORIZED',
	SYSTEM_ERROR: 'SYSTEM_ERROR',
} as const;

export type AuthFailureReason =
	(typeof AuthFailureReason)[keyof typeof AuthFailureReason];

async function getUserPermissions(user_id: number) {
	const cacheKey = cacheProvider.buildKey(
		UserEntity.NAME,
		user_id.toString(),
		'permissions',
	);

	const cacheGetResults = await cacheProvider.get(cacheKey, async () => {
		const userPermissions =
			await getUserPermissionRepository().getUserPermissions(user_id);

		return userPermissions.reduce<AuthContextPermissions>(
			(acc, { permission_entity, permission_operation }) => {
				if (!acc[permission_entity]) {
					acc[permission_entity] = [];
				}

				acc[permission_entity].push(permission_operation);

				return acc;
			},
			{},
		);
	});

	return cacheGetResults.data as AuthContextPermissions;
}

/**
 * The user behind a session, cached under the user's keyspace so `cleanEntityCache(UserEntity, id)`
 * - run by every user write and by the repository's delete/restore - drops it with the rest.
 *
 * The password hash is reduced to `has_password` before caching: `meDetails` serializes the whole
 * auth object into the `/account/me` response, so the hash must not be in it - and this way it
 * never reaches Redis either. The frontend needs the boolean to tell a social-only account (no
 * password to change, none to confirm on delete) from a normal one. A missing user is not cached; the session is discarded on that answer anyway.
 */
async function getUserContext(user_id: number) {
	const cacheKey = cacheProvider.buildKey(
		UserEntity.NAME,
		user_id.toString(),
		'auth',
	);

	const cacheGetResults = await cacheProvider.get(cacheKey, async () => {
		const user = await getUserRepository()
			.createQuery()
			.select([
				'id',
				'name',
				'email',
				'email_verified_at',
				'password',
				'password_updated_at',
				'language',
				'role',
				'operator_type',
				'status',
				'created_at',
			])
			.filterById(user_id)
			.first();

		if (!user) {
			return null;
		}

		const { password, ...userContext } = user;

		return { ...userContext, has_password: !!password };
	});

	return cacheGetResults.data as
		| (Omit<UserEntity, 'password'> & { has_password: boolean })
		| null;
}

/**
 * Deletes a session found dead mid-request, without holding the request up for it.
 */
function discardSession(session: AuthSession): void {
	getAccountTokenRepository().removeTokenById(session.id);

	runInBackground(
		accountTokenService.forgetSessions([session.ident]),
		`Failed to drop cached account token #${session.id}`,
	);
}

function setAuthFailure(
	reason: AuthFailureReason,
	details?: Record<string, unknown>,
) {
	if (Configuration.isEnvironment('development')) {
		console.error(`[Auth] ${createCurrentDate()} ${reason}`, details);
	}
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
	try {
		// Initialize the user as a visitor
		res.locals.auth = {
			id: 0,
			email: '',
			name: '',
			language: Configuration.language(),
			role: 'visitor',
			operator_type: null,
			permissions: {},
			has_password: false,
			activeToken: '',
		};

		// Read the token from the request
		const token = accountTokenService.getAuthTokenFromHeaders(req);

		if (!token) {
			setAuthFailure(AuthFailureReason.NO_TOKEN);

			return next();
		}

		let activeToken: AuthSession;

		try {
			activeToken = await accountTokenService.findSessionByToken(token);
		} catch (error) {
			setAuthFailure(AuthFailureReason.INVALID_TOKEN, {
				token: token,
				error: error instanceof Error ? error.message : 'Unknown error',
			});

			return next();
		}

		// Check if the token is expired
		if (activeToken.expire_at < createCurrentDate()) {
			discardSession(activeToken);

			setAuthFailure(AuthFailureReason.TOKEN_EXPIRED, { ...activeToken });

			return next();
		}

		// Validate metadata (e.g., user-agent check)
		if (
			Configuration.isEnvironment('production') &&
			(!activeToken.metadata ||
				!compareMetaDataValue(
					activeToken.metadata,
					tokenMetaData(req),
					'user-agent',
				))
		) {
			setAuthFailure(AuthFailureReason.METADATA_MISMATCH, {
				...activeToken,
				currentMetadata: tokenMetaData(req),
			});

			return next();
		}

		const user = await getUserContext(activeToken.user_id);

		// User was not found
		if (!user) {
			discardSession(activeToken);

			setAuthFailure(AuthFailureReason.USER_NOT_FOUND, {
				...activeToken,
			});

			return next();
		}

		// User is inactive
		if (user.status !== UserStatusEnum.ACTIVE) {
			discardSession(activeToken);

			setAuthFailure(AuthFailureReason.USER_INACTIVE, {
				...activeToken,
			});

			return next();
		}

		// Record the use and extend the token if it's close to expiration
		await accountTokenService.touchSession(activeToken);

		// Attach user information to the request object
		res.locals.auth = {
			...user,
			permissions: await getUserPermissions(user.id),
			activeToken: activeToken.ident,
		};

		next();
	} catch (err) {
		setAuthFailure(AuthFailureReason.SYSTEM_ERROR, {
			error:
				err instanceof Error
					? {
							message: err.message,
							stack: err.stack,
						}
					: 'Unknown system error',
		});

		next(err);
	}
}

export default authMiddleware;
