import type { NextFunction, Request, Response } from 'express';
import { Configuration } from '@/config/settings.config';
import type AccountTokenEntity from '@/features/account/account-token.entity';
import { getAccountTokenRepository } from '@/features/account/account-token.repository';
import { accountTokenService } from '@/features/account/account-token.service';
import UserEntity, { UserStatusEnum } from '@/features/user/user.entity';
import { getUserRepository } from '@/features/user/user.repository';
import { getUserPermissionRepository } from '@/features/user-permission/user-permission.repository';
import {
	createCurrentDate,
	createFutureDate,
	dateDiff,
} from '@/helpers/date.helper';
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

		let activeToken: AccountTokenEntity;

		try {
			activeToken = await accountTokenService.findByToken(token);
		} catch (error) {
			setAuthFailure(AuthFailureReason.INVALID_TOKEN, {
				token: token,
				error: error instanceof Error ? error.message : 'Unknown error',
			});

			return next();
		}

		// Check if the token is expired
		if (activeToken.expire_at < createCurrentDate()) {
			getAccountTokenRepository().removeTokenById(activeToken.id);

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
			.filterById(activeToken.user_id)
			.first();

		// User was not found
		if (!user) {
			getAccountTokenRepository().removeTokenById(activeToken.id);

			setAuthFailure(AuthFailureReason.USER_NOT_FOUND, {
				...activeToken,
			});

			return next();
		}

		// User is inactive
		if (user.status !== UserStatusEnum.ACTIVE) {
			getAccountTokenRepository().removeTokenById(activeToken.id);

			setAuthFailure(AuthFailureReason.USER_INACTIVE, {
				...activeToken,
			});

			return next();
		}

		// Refresh the token if it's close to expiration
		const secondsRemaining = dateDiff(
			createCurrentDate(),
			activeToken.expire_at,
			'seconds',
		);

		if (secondsRemaining < Configuration.get('user.authRefreshExpiresIn')) {
			await getAccountTokenRepository().update(activeToken.id, {
				used_at: createCurrentDate(),
				expire_at: createFutureDate(
					Configuration.get('user.authExpiresIn'),
				),
			});
		} else {
			await getAccountTokenRepository().update(activeToken.id, {
				used_at: createCurrentDate(),
			});
		}

		/*
		 * `password` is pulled out rather than spread: `meDetails` serializes the whole auth
		 * object into the `/account/me` response, so leaving it in would publish the hash.
		 * Only the boolean survives - the frontend needs it to tell a social-only account
		 * (no password to change, none to confirm on delete) from a normal one.
		 */
		const { password, ...userContext } = user;

		// Attach user information to the request object
		res.locals.auth = {
			...userContext,
			has_password: !!password,
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
