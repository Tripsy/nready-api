import { createSecretKey, type KeyObject } from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import type { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { Configuration } from '@/config/settings.config';
import { CustomError } from '@/exceptions';
import AccountTokenEntity from '@/features/account/account-token.entity';
import {
	type AccountTokenQuery,
	getAccountTokenRepository,
} from '@/features/account/account-token.repository';
import type UserEntity from '@/features/user/user.entity';
import {
	createCurrentDate,
	createFutureDate,
	dateDiff,
} from '@/helpers/date.helper';
import { getMetaDataValue, tokenMetaData } from '@/helpers/meta-data.helper';
import { getErrorMessage } from '@/helpers/system.helper';
import { cacheProvider } from '@/providers/cache.provider';

let authSecretKey: KeyObject | null = null;

/**
 * The session secret as a `KeyObject`, built once. Handed a string, `jsonwebtoken` first tries
 * `createPublicKey` on it, catches the failure and falls back to `createSecretKey` - on every
 * verify, so on every signed-in request. Built lazily so tests that never touch a token never read
 * the setting.
 */
function getAuthSecretKey(): KeyObject {
	authSecretKey ??= createSecretKey(
		Buffer.from(Configuration.get('user.authSecret')),
	);

	return authSecretKey;
}

export type AuthTokenPayload = {
	user_id: number;
	ident: string;
};

/** The part of a session row `authMiddleware` reads, as cached between requests. */
export type AuthSession = Pick<
	AccountTokenEntity,
	'id' | 'user_id' | 'ident' | 'metadata' | 'used_at' | 'expire_at'
>;

export type AuthValidToken = {
	ident: string;
	label: string;
	used_at: Date | null;
	used_now: boolean;
};

export class AccountTokenService {
	constructor(
		private accountTokenRepository: Repository<AccountTokenEntity> & {
			createQuery(): AccountTokenQuery;
		},
	) {}

	/**
	 * @description Gets the auth token from the request headers
	 * @param req
	 */
	public getAuthTokenFromHeaders(req: Request): string | undefined {
		return req.headers.authorization?.split(' ')[1];
	}

	/**
	 * @description Verify auth token and return payload
	 * @param token
	 */
	public determineAuthTokenPayload(token: string): AuthTokenPayload {
		try {
			return jwt.verify(token, getAuthSecretKey()) as AuthTokenPayload;
		} catch (err) {
			throw new CustomError(
				406,
				`Unable to verify token ${getErrorMessage(err)}`,
			);
		}
	}

	/**
	 * @description Gets the active auth token from the request headers
	 */
	public findByToken(token: string): Promise<AccountTokenEntity> {
		// Verify JWT and extract payload
		const authTokenPayload = this.determineAuthTokenPayload(token);

		return this.accountTokenRepository
			.createQuery()
			.filterByIdent(authTokenPayload.ident)
			.filterBy('user_id', authTokenPayload.user_id)
			.firstOrFail();
	}

	/**
	 * The session a request's token stands for, read through the cache - `authMiddleware` asks on
	 * every signed-in request, and the row barely changes between them.
	 *
	 * Keyed by `ident` alone: the JWT is verified before the key is built, so an `ident` arrives
	 * here only alongside the `user_id` it was signed with, and the row is still read filtered by
	 * both. Every path that deletes a session drops its key (`forgetSessions`), so a revoked token
	 * does not outlive its row by the TTL. A miss is not cached - `firstOrFail` throws, and the
	 * next request asks the database again.
	 *
	 * The cache hands dates back as strings; they are revived here so callers compare real dates.
	 */
	public async findSessionByToken(token: string): Promise<AuthSession> {
		const payload = this.determineAuthTokenPayload(token);

		const cached = await cacheProvider.get(
			this.sessionCacheKey(payload.ident),
			() =>
				this.accountTokenRepository
					.createQuery()
					.select([
						'id',
						'user_id',
						'ident',
						'metadata',
						'used_at',
						'expire_at',
					])
					.filterByIdent(payload.ident)
					.filterBy('user_id', payload.user_id)
					.firstOrFail(),
		);

		const session = cached.data as AuthSession;

		return {
			...session,
			used_at: session.used_at ? new Date(session.used_at) : null,
			expire_at: new Date(session.expire_at),
		};
	}

	/**
	 * Records the session as used and, close to expiry, extends it.
	 *
	 * `used_at` feeds the active-sessions list, where minute precision is all anyone reads, so it
	 * is written at most once per `user.authTouchInterval` - otherwise every signed-in request
	 * would carry a write to the same row. The extension is never deferred. The cached copy is
	 * rewritten with what was stored, so the next request sees the write it would otherwise read
	 * back from the row.
	 */
	public async touchSession(session: AuthSession): Promise<void> {
		const now = createCurrentDate();

		const extend =
			dateDiff(now, session.expire_at, 'seconds') <
			Configuration.get('user.authRefreshExpiresIn');
		const stale =
			!session.used_at ||
			dateDiff(session.used_at, now, 'seconds') >=
				Configuration.get('user.authTouchInterval');

		if (!extend && !stale) {
			return;
		}

		const changes: Pick<AuthSession, 'used_at'> &
			Partial<Pick<AuthSession, 'expire_at'>> = extend
			? {
					used_at: now,
					expire_at: createFutureDate(
						Configuration.get('user.authExpiresIn'),
					),
				}
			: { used_at: now };

		await this.accountTokenRepository.update(session.id, changes);

		await cacheProvider.set(this.sessionCacheKey(session.ident), {
			...session,
			...changes,
		});
	}

	/**
	 * Drops cached sessions, for every path that deletes their rows - see `findSessionByToken`.
	 */
	public async forgetSessions(idents: string[]): Promise<void> {
		await Promise.all(
			idents.map((ident) =>
				cacheProvider.delete(this.sessionCacheKey(ident)),
			),
		);
	}

	private sessionCacheKey(ident: string): string {
		return cacheProvider.buildKey(AccountTokenEntity.NAME, ident);
	}

	/**
	 * @description Generates a new auth token
	 */
	public generateAuthToken(user: Partial<UserEntity> & { id: number }): {
		token: string;
		ident: string;
		expire_at: Date;
	} {
		if (!user.id) {
			throw new Error('User object must contain `id` property.');
		}

		const ident: string = uuid();
		const expire_at: Date = createFutureDate(
			Configuration.get('user.authExpiresIn'),
		);

		const payload: AuthTokenPayload = {
			user_id: user.id,
			ident: ident,
		};

		const token = jwt.sign(payload, getAuthSecretKey());

		return { token, ident, expire_at };
	}

	/**
	 * @description Gets the valid auth tokens for a user via repository
	 */
	public async getAuthValidTokens(
		user_id: number,
	): Promise<AuthValidToken[]> {
		const authValidTokens = await this.accountTokenRepository
			.createQuery()
			.select(['id', 'ident', 'metadata', 'used_at'])
			.filterBy('user_id', user_id)
			.filterByRange('expire_at', createCurrentDate())
			.all(false);

		return authValidTokens.map((token) => {
			return {
				ident: token.ident,
				label: token.metadata
					? getMetaDataValue(token.metadata, 'user-agent')
					: '',
				used_at: token.used_at,
				used_now: false,
			};
		});
	}

	/**
	 * @description Creates a new auth token via repository
	 */
	private createAuthToken(
		data: Partial<AccountTokenEntity>,
	): Promise<AccountTokenEntity> {
		const entry = {
			user_id: data.user_id,
			ident: data.ident,
			metadata: data.metadata,
			used_at: data.used_at,
			expire_at: data.expire_at,
		};

		return this.accountTokenRepository.save(entry);
	}

	/**
	 * @description Generate a new auth token and returns the token
	 */
	public async setupAuthToken(
		user: Partial<UserEntity> & { id: number },
		req: Request,
	): Promise<string> {
		const { token, ident, expire_at } = this.generateAuthToken(user);

		await this.createAuthToken({
			user_id: user.id,
			ident: ident,
			metadata: tokenMetaData(req),
			used_at: createCurrentDate(),
			expire_at: expire_at,
		});

		return token;
	}

	/**
	 * @description Removes all auth tokens for a user
	 */
	public async removeAccountTokenForUser(user_id: number): Promise<void> {
		const tokens = await this.accountTokenRepository
			.createQuery()
			.select(['id', 'ident'])
			.filterBy('user_id', user_id)
			.all(false);

		await this.accountTokenRepository
			.createQuery()
			.filterBy('user_id', user_id)
			.delete(false, true);

		await this.forgetSessions(tokens.map((token) => token.ident));
	}

	/**
	 * @description Removes a single auth token for a user
	 */
	public async removeAccountTokenByIdent(ident: string): Promise<void> {
		await this.accountTokenRepository
			.createQuery()
			.filterByIdent(ident)
			.delete(false);

		await this.forgetSessions([ident]);
	}
}

export const accountTokenService = new AccountTokenService(
	getAccountTokenRepository(),
);
