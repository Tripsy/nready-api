import { expect, jest } from '@jest/globals';
import { CustomError } from '@/exceptions';
import type AccountTokenEntity from '@/features/account/account-token.entity';
import type { AccountTokenQuery } from '@/features/account/account-token.repository';
import { AccountTokenService } from '@/features/account/account-token.service';
import { getUserEntityMock } from '@/features/user/user.mock';
import { createCurrentDate } from '@/helpers/date.helper';
import { createMockRepository } from '@/tests/jest-service.setup';

/**
 * These tests have been created by Cursor they may not be 100% sufficient
 */
describe('AccountTokenService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockAccountToken = createMockRepository<
		AccountTokenEntity,
		AccountTokenQuery
	>();

	const serviceAccountToken = new AccountTokenService(
		mockAccountToken.repository,
	);

	it('getAuthTokenFromHeaders should return token from Authorization header', () => {
		const req = {
			headers: { authorization: 'Bearer my-token-value' },
		} as never;

		const result = serviceAccountToken.getAuthTokenFromHeaders(req);

		expect(result).toBe('my-token-value');
	});

	it('getAuthTokenFromHeaders should return undefined when no header', () => {
		const req = { headers: {} } as never;

		const result = serviceAccountToken.getAuthTokenFromHeaders(req);

		expect(result).toBeUndefined();
	});

	it('determineAuthTokenPayload should throw on invalid token', () => {
		expect(() =>
			serviceAccountToken.determineAuthTokenPayload('invalid-jwt'),
		).toThrow(CustomError);
	});

	it('findByToken should use query filterByIdent and firstOrFail', async () => {
		jest.spyOn(
			serviceAccountToken,
			'determineAuthTokenPayload',
		).mockReturnValue({
			user_id: 1,
			ident: 'some-ident',
		});
		const entity = { id: 1, user_id: 1, ident: 'some-ident' };
		mockAccountToken.query.firstOrFail.mockResolvedValue(entity);

		const result = await serviceAccountToken.findByToken('any-token');

		expect(mockAccountToken.query.filterByIdent).toHaveBeenCalledWith(
			'some-ident',
		);
		expect(mockAccountToken.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			1,
		);
		expect(result).toBe(entity);
	});

	it('generateAuthToken should throw when user has no id', () => {
		expect(() =>
			serviceAccountToken.generateAuthToken({} as { id: number }),
		).toThrow('User object must contain `id` property.');
	});

	it('generateAuthToken should return token, ident, expire_at', () => {
		const result = serviceAccountToken.generateAuthToken({
			id: getUserEntityMock().id,
		});

		expect(result).toHaveProperty('token');
		expect(result).toHaveProperty('ident');
		expect(result).toHaveProperty('expire_at');
		expect(result.expire_at).toBeInstanceOf(Date);
	});

	// it('getAuthValidTokens should return mapped AuthValidToken array', async () => {
	// 	mockAccountToken.query.all.mockResolvedValue([getAccountTokenMock()]);
	//
	// 	const result = await serviceAccountToken.getAuthValidTokens(1);
	//
	// 	expect(mockAccountToken.query.filterBy).toHaveBeenCalledWith(
	// 		'user_id',
	// 		1,
	// 	);
	// 	expect(mockAccountToken.query.filterByRange).toHaveBeenCalledWith(
	// 		'expire_at',
	// 		expect.any(Date),
	// 	);
	// 	expect(result).toHaveLength(1);
	// 	expect(result[0]).toHaveProperty('ident', 'i1');
	// 	expect(result[0]).toHaveProperty('used_now', false);
	// });

	it('setupAuthToken should create token and return token string', async () => {
		jest.spyOn(serviceAccountToken, 'generateAuthToken').mockReturnValue({
			token: 'jwt-string',
			ident: 'ident-uuid',
			expire_at: createCurrentDate(),
		});
		mockAccountToken.repository.save.mockResolvedValue({} as never);

		const req = { headers: {} } as never;
		const result = await serviceAccountToken.setupAuthToken(
			{ id: getUserEntityMock().id },
			req,
		);

		expect(mockAccountToken.repository.save).toHaveBeenCalled();
		expect(result).toBe('jwt-string');
	});

	it('removeAccountTokenForUser should call query delete', async () => {
		mockAccountToken.query.all.mockResolvedValue([
			{ id: 1, ident: 'ident-1' },
			{ id: 2, ident: 'ident-2' },
		] as never);
		mockAccountToken.query.delete.mockResolvedValue(1);
		const forgetSpy = jest.spyOn(serviceAccountToken, 'forgetSessions');

		await serviceAccountToken.removeAccountTokenForUser(1);

		expect(mockAccountToken.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			1,
		);
		expect(mockAccountToken.query.delete).toHaveBeenCalledWith(false, true);
		// A cached session must not outlive its row
		expect(forgetSpy).toHaveBeenCalledWith(['ident-1', 'ident-2']);
	});

	it('removeAccountTokenByIdent should call query filterByIdent and delete', async () => {
		mockAccountToken.query.delete.mockResolvedValue(1);

		await serviceAccountToken.removeAccountTokenByIdent('ident-123');

		expect(mockAccountToken.query.filterByIdent).toHaveBeenCalledWith(
			'ident-123',
		);
		expect(mockAccountToken.query.delete).toHaveBeenCalledWith(false);
	});

	it('removeAccountTokenByIdent drops the cached session', async () => {
		mockAccountToken.query.delete.mockResolvedValue(1);
		const forgetSpy = jest.spyOn(serviceAccountToken, 'forgetSessions');

		await serviceAccountToken.removeAccountTokenByIdent('ident-123');

		expect(forgetSpy).toHaveBeenCalledWith(['ident-123']);
	});

	// The cache hands dates back as strings
	it('findSessionByToken returns real dates', async () => {
		jest.spyOn(
			serviceAccountToken,
			'determineAuthTokenPayload',
		).mockReturnValue({ user_id: 7, ident: 'ident-123' });
		mockAccountToken.query.firstOrFail.mockResolvedValue({
			id: 1,
			user_id: 7,
			ident: 'ident-123',
			metadata: null,
			used_at: '2026-01-01T10:00:00.000Z',
			expire_at: '2026-01-02T10:00:00.000Z',
		} as never);

		const session = await serviceAccountToken.findSessionByToken('jwt');

		expect(session.used_at).toBeInstanceOf(Date);
		expect(session.expire_at).toBeInstanceOf(Date);
		expect(mockAccountToken.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			7,
		);
	});
});
