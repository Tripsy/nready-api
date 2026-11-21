import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError, NotFoundError } from '@/exceptions';
import type AccountIdentityEntity from '@/features/account/account-identity.entity';
import { AccountIdentityProviderEnum } from '@/features/account/account-identity.entity';
import type { AccountIdentityQuery } from '@/features/account/account-identity.repository';
import type { OAuthProfile } from '@/features/account/account-oauth.client';
import { AccountOAuthService } from '@/features/account/account-oauth.service';
import type AccountTokenEntity from '@/features/account/account-token.entity';
import type { AccountTokenQuery } from '@/features/account/account-token.repository';
import { AccountTokenService } from '@/features/account/account-token.service';
import type UserEntity from '@/features/user/user.entity';
import { UserStatusEnum } from '@/features/user/user.entity';
import { getUserEntityMock } from '@/features/user/user.mock';
import type { UserQuery } from '@/features/user/user.repository';
import { UserService } from '@/features/user/user.service';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

// Derived from the configured frontend origin - that is exactly what the guard accepts.
const REDIRECT_URI = `${Configuration.get('frontend.url')}/auth/callback/google`;

function getOAuthProfileMock(
	overwrite: Partial<OAuthProfile> = {},
): OAuthProfile {
	return {
		provider_user_id: 'google-subject-123',
		email: 'user@example.com',
		email_verified: true,
		name: 'John Doe',
		...overwrite,
	};
}

function getAccountIdentityMock(): AccountIdentityEntity {
	return {
		id: mockId(1),
		user_id: mockId(1),
		provider: AccountIdentityProviderEnum.GOOGLE,
		provider_user_id: 'google-subject-123',
		email: 'user@example.com',
		created_at: new Date(),
		last_login_at: null,
	};
}

describe('AccountOAuthService', () => {
	const mockAccountIdentity = createMockRepository<
		AccountIdentityEntity,
		AccountIdentityQuery
	>();
	const mockAccountToken = createMockRepository<
		AccountTokenEntity,
		AccountTokenQuery
	>();
	const mockUser = createMockRepository<UserEntity, UserQuery>();

	const serviceUser = new UserService(
		mockUser.repository,
		new AccountTokenService(mockAccountToken.repository),
	);

	// The provider round-trip is injected, so the suite never opens a socket.
	const resolveProfile =
		jest.fn<(...args: unknown[]) => Promise<OAuthProfile>>();

	const service = new AccountOAuthService(
		mockAccountIdentity.repository,
		serviceUser,
		resolveProfile,
	);

	beforeEach(() => {
		jest.restoreAllMocks();

		resolveProfile.mockReset();
		mockAccountIdentity.query.first.mockResolvedValue(null);
		mockAccountIdentity.repository.save.mockImplementation(
			async (entry) => entry,
		);
	});

	/**
	 * `all` is overloaded and the mock picks up the `withCount: true` tuple signature, so
	 * the array-only result of `all(false)` has to be cast through.
	 */
	function mockIdentityList(identities: AccountIdentityEntity[]) {
		mockAccountIdentity.query.all.mockResolvedValue(
			identities as unknown as [AccountIdentityEntity[], number],
		);
	}

	function mockProfile(profile: OAuthProfile) {
		resolveProfile.mockResolvedValue(profile);

		return resolveProfile;
	}

	it('rejects a redirect_uri outside the frontend origin', async () => {
		const resolveSpy = mockProfile(getOAuthProfileMock());

		await expect(
			service.resolveUser(
				AccountIdentityProviderEnum.GOOGLE,
				'some_code',
				'https://attacker.example/callback',
				'en',
			),
		).rejects.toThrow(BadRequestError);

		// The code must never be forwarded to the provider when the URI is refused.
		expect(resolveSpy).not.toHaveBeenCalled();
	});

	it('returns the linked user when the identity is already known', async () => {
		mockProfile(getOAuthProfileMock());

		const user = { ...getUserEntityMock(), status: UserStatusEnum.ACTIVE };

		mockAccountIdentity.query.first.mockResolvedValue(
			getAccountIdentityMock(),
		);
		jest.spyOn(serviceUser, 'findById').mockResolvedValue(user);

		const findByEmailSpy = jest.spyOn(serviceUser, 'findByEmail');

		const result = await service.resolveUser(
			AccountIdentityProviderEnum.GOOGLE,
			'some_code',
			REDIRECT_URI,
			'en',
		);

		expect(result).toBe(user);
		// The subject id is authoritative; a known identity must not be re-matched by email.
		expect(findByEmailSpy).not.toHaveBeenCalled();
	});

	it('refuses to match an existing account on an unverified provider email', async () => {
		mockProfile(getOAuthProfileMock({ email_verified: false }));

		const findByEmailSpy = jest.spyOn(serviceUser, 'findByEmail');

		await expect(
			service.resolveUser(
				AccountIdentityProviderEnum.GOOGLE,
				'some_code',
				REDIRECT_URI,
				'en',
			),
		).rejects.toThrow(BadRequestError);

		expect(findByEmailSpy).not.toHaveBeenCalled();
	});

	it('fails when the provider shares no email', async () => {
		mockProfile(getOAuthProfileMock({ email: null }));

		await expect(
			service.resolveUser(
				AccountIdentityProviderEnum.FACEBOOK,
				'some_code',
				REDIRECT_URI,
				'en',
			),
		).rejects.toThrow(BadRequestError);
	});

	it('creates an active, passwordless account when the email is unknown', async () => {
		mockProfile(getOAuthProfileMock());

		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue(null);

		const createSpy = jest
			.spyOn(serviceUser, 'createRegister')
			.mockResolvedValue({
				...getUserEntityMock(),
				status: UserStatusEnum.ACTIVE,
			});

		await service.resolveUser(
			AccountIdentityProviderEnum.GOOGLE,
			'some_code',
			REDIRECT_URI,
			'en',
		);

		const created = createSpy.mock.calls[0][0];

		expect(created.password).toBeUndefined();
		expect(created.status).toBe(UserStatusEnum.ACTIVE);
		expect(created.email_verified_at).toBeInstanceOf(Date);
		expect(mockAccountIdentity.repository.save).toHaveBeenCalled();
	});

	it('links to an existing account and completes a pending registration', async () => {
		mockProfile(getOAuthProfileMock());

		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
			email_verified_at: null,
		});

		const updateSpy = jest
			.spyOn(serviceUser, 'update')
			.mockResolvedValue(getUserEntityMock());

		const result = await service.resolveUser(
			AccountIdentityProviderEnum.GOOGLE,
			'some_code',
			REDIRECT_URI,
			'en',
		);

		expect(result.status).toBe(UserStatusEnum.ACTIVE);
		expect(updateSpy.mock.calls[0][0].status).toBe(UserStatusEnum.ACTIVE);
		expect(mockAccountIdentity.repository.save).toHaveBeenCalled();
	});

	it('refuses to log in a soft-deleted account', async () => {
		mockProfile(getOAuthProfileMock());

		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
			deleted_at: new Date(),
		});

		await expect(
			service.resolveUser(
				AccountIdentityProviderEnum.GOOGLE,
				'some_code',
				REDIRECT_URI,
				'en',
			),
		).rejects.toThrow(NotFoundError);
	});

	it('refuses to unlink the only sign-in method of a passwordless account', async () => {
		mockIdentityList([getAccountIdentityMock()]);

		await expect(
			service.unlink(
				{ ...getUserEntityMock(), password: null },
				AccountIdentityProviderEnum.GOOGLE,
			),
		).rejects.toThrow(CustomError);

		expect(mockAccountIdentity.query.delete).not.toHaveBeenCalled();
	});

	it('unlinks when the account still has a password', async () => {
		mockIdentityList([getAccountIdentityMock()]);

		await service.unlink(
			getUserEntityMock(),
			AccountIdentityProviderEnum.GOOGLE,
		);

		expect(mockAccountIdentity.query.delete).toHaveBeenCalled();
	});
});
