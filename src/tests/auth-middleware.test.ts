import { jest } from '@jest/globals';
import express, { type Express } from 'express';
import request from 'supertest';
import type UserEntity from '@/features/user/user.entity';
import type { UserQuery } from '@/features/user/user.repository';
import { createMockRepository } from '@/tests/jest-service.setup';

/*
 * `createApp()` skips `authMiddleware` under APP_ENV=test (see `app.ts`), which is what
 * lets every other controller test simulate auth by spying on the policy. That also means
 * nothing in the suite exercises the middleware itself - so this file mounts it directly on
 * a minimal app: output handler, the middleware, and the one route that serializes whatever
 * the middleware produced.
 *
 * The property under test is that the password hash never reaches the response.
 * `authMiddleware` selects the `password` column (it needs to know whether one exists) and
 * `meDetails` sends `res.locals.auth` verbatim, so the two are one edit away from
 * publishing credentials. TypeScript will not catch it: an object spread is exempt from
 * excess-property checks, so restoring `...user` compiles cleanly.
 */

const mockUser = createMockRepository<UserEntity, UserQuery>();

// `jest.mock` does not hoist under the ESM preset, so the mocks are registered first and
// the subject imported dynamically afterwards (see rules/testing.md §2.2).
jest.unstable_mockModule('@/features/user/user.repository', () => ({
	getUserRepository: () => mockUser.repository,
}));

// `findSessionByToken` is stubbed below, so the query side of this repository is never reached -
// only the `update` `touchSession` makes to record the use or slide the expiry forward, and the
// fire-and-forget cleanup helper.
const tokenUpdate = jest.fn();

jest.unstable_mockModule('@/features/account/account-token.repository', () => ({
	getAccountTokenRepository: () => ({
		update: tokenUpdate,
		removeTokenById: jest.fn(),
	}),
}));

// The test cache provider runs every fetch, so `getUserPermissions` reaches this repository
jest.unstable_mockModule(
	'@/features/user-permission/user-permission.repository',
	() => ({
		getUserPermissionRepository: () => ({
			getUserPermissions: async () => [],
		}),
	}),
);

const { default: authMiddleware } = await import(
	'@/middleware/auth.middleware'
);
const { outputHandler } = await import(
	'@/middleware/output-handler.middleware'
);
const { errorHandler } = await import('@/middleware/error-handler.middleware');
const { accountController } = await import(
	'@/features/account/account.controller'
);
const { accountTokenService } = await import(
	'@/features/account/account-token.service'
);
const { cacheProvider } = await import('@/providers/cache.provider');
const { UserStatusEnum } = await import('@/features/user/user.entity');
const { createFutureDate, createPastDate } = await import(
	'@/helpers/date.helper'
);
const { Configuration } = await import('@/config/settings.config');

const PASSWORD_HASH =
	'$2b$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012';

function buildApp(): Express {
	const app = express();

	app.use(express.json());
	app.use(outputHandler);
	app.use(authMiddleware);
	app.get('/account/me', accountController.meDetails);
	app.use(errorHandler);

	return app;
}

function getAuthUserMock(overwrite: Partial<UserEntity> = {}) {
	return {
		id: 7,
		name: 'John Doe',
		email: 'john.doe@example.com',
		email_verified_at: createPastDate(86400),
		password: PASSWORD_HASH,
		password_updated_at: createPastDate(86400),
		language: 'en',
		role: 'admin',
		operator_type: null,
		status: UserStatusEnum.ACTIVE,
		created_at: createPastDate(864000),
		...overwrite,
	} as unknown as UserEntity;
}

let app: Express;

beforeAll(() => {
	app = buildApp();
});

function mockSession(
	overwrite: Partial<{ used_at: Date | null; expire_at: Date }> = {},
) {
	jest.spyOn(accountTokenService, 'findSessionByToken').mockResolvedValue({
		id: 1,
		user_id: 7,
		ident: 'token-ident',
		metadata: { 'user-agent': 'test-agent' },
		used_at: createPastDate(3600),
		expire_at: createFutureDate(86400),
		...overwrite,
	});
}

beforeEach(() => {
	mockSession();
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('authMiddleware -> GET /account/me', () => {
	it('never sends the password hash in the response', async () => {
		mockUser.query.first.mockResolvedValue(getAuthUserMock());

		const response = await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(response.status).toBe(200);
		expect(response.body.data).not.toHaveProperty('password');

		// Belt and braces: the hash must not appear anywhere in the payload, including
		// somewhere nested that a property check would miss.
		expect(JSON.stringify(response.body)).not.toContain(PASSWORD_HASH);
	});

	it('reports has_password true for an account with a password', async () => {
		mockUser.query.first.mockResolvedValue(getAuthUserMock());

		const response = await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(response.body.data).toHaveProperty('has_password', true);
	});

	it('reports has_password false for a social sign-in account', async () => {
		mockUser.query.first.mockResolvedValue(
			getAuthUserMock({ password: null }),
		);

		const response = await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(response.body.data).toHaveProperty('has_password', false);
		expect(response.body.data).not.toHaveProperty('password');
	});

	it('still exposes the fields the frontend auth model depends on', async () => {
		mockUser.query.first.mockResolvedValue(getAuthUserMock());

		const response = await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		// Stripping `password` must not take the rest of the user object with it.
		for (const field of [
			'id',
			'name',
			'email',
			'email_verified_at',
			'password_updated_at',
			'language',
			'role',
			'created_at',
			'permissions',
			'activeToken',
		]) {
			expect(response.body.data).toHaveProperty(field);
		}
	});

	// The user context is cached between requests; the hash must not travel to Redis either
	it('caches the user without the password hash', async () => {
		mockUser.query.first.mockResolvedValue(getAuthUserMock());

		const cached: unknown[] = [];
		const originalGet = cacheProvider.get.bind(cacheProvider);

		jest.spyOn(cacheProvider, 'get').mockImplementation(
			async (key, fetchFunction, ttl) => {
				const results = await originalGet(key, fetchFunction, ttl);

				cached.push(results.data);

				return results;
			},
		);

		await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(cached.length).toBeGreaterThan(0);
		expect(JSON.stringify(cached)).not.toContain(PASSWORD_HASH);
	});

	it('answers 401 without a token', async () => {
		const response = await request(app).get('/account/me');

		expect(response.status).toBe(401);
	});
});

describe('authMiddleware -> token expiry refresh', () => {
	function mockTokenExpiringIn(seconds: number) {
		mockSession({ expire_at: createFutureDate(seconds) });
	}

	beforeEach(() => {
		tokenUpdate.mockClear();
		mockUser.query.first.mockResolvedValue(getAuthUserMock());
	});

	it('only touches used_at while the token has plenty of time left', async () => {
		mockTokenExpiringIn(Configuration.get('user.authRefreshExpiresIn') * 2);

		await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(tokenUpdate).toHaveBeenCalledTimes(1);
		expect(tokenUpdate.mock.calls[0][1]).not.toHaveProperty('expire_at');
	});

	it('extends the expiry once the token is inside the refresh window', async () => {
		mockTokenExpiringIn(
			Math.floor(Configuration.get('user.authRefreshExpiresIn') / 2),
		);

		await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(tokenUpdate).toHaveBeenCalledTimes(1);
		expect(tokenUpdate.mock.calls[0][1]).toHaveProperty('expire_at');
	});

	// A busy session would otherwise write its row on every request
	it('skips the write when the token was used within the touch interval', async () => {
		mockSession({ used_at: createPastDate(1) });

		const response = await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(response.status).toBe(200);
		expect(tokenUpdate).not.toHaveBeenCalled();
	});

	it('still extends a recently used token inside the refresh window', async () => {
		mockSession({
			used_at: createPastDate(1),
			expire_at: createFutureDate(
				Math.floor(Configuration.get('user.authRefreshExpiresIn') / 2),
			),
		});

		await request(app)
			.get('/account/me')
			.set('Authorization', 'Bearer some_token');

		expect(tokenUpdate).toHaveBeenCalledTimes(1);
		expect(tokenUpdate.mock.calls[0][1]).toHaveProperty('expire_at');
	});
});
