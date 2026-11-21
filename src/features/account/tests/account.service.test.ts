import { expect, jest } from '@jest/globals';
import { BadRequestError, CustomError } from '@/exceptions';
import { AccountService } from '@/features/account/account.service';
import { AccountEmailService } from '@/features/account/account-email.service';
import type AccountRecoveryEntity from '@/features/account/account-recovery.entity';
import type { AccountRecoveryQuery } from '@/features/account/account-recovery.repository';
import { AccountRecoveryService } from '@/features/account/account-recovery.service';
import type AccountTokenEntity from '@/features/account/account-token.entity';
import type { AccountTokenQuery } from '@/features/account/account-token.repository';
import { AccountTokenService } from '@/features/account/account-token.service';
import type UserEntity from '@/features/user/user.entity';
import { UserStatusEnum } from '@/features/user/user.entity';
import { getUserEntityMock } from '@/features/user/user.mock';
import type { UserQuery } from '@/features/user/user.repository';
import { UserService } from '@/features/user/user.service';
import { createFutureDate } from '@/helpers/date.helper';
import { encryptPassword } from '@/helpers/security.helper';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * These tests have been created by Cursor they may not be 100% sufficient
 */
describe('AccountService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockAccountToken = createMockRepository<
		AccountTokenEntity,
		AccountTokenQuery
	>();
	const mockUser = createMockRepository<UserEntity, UserQuery>();
	const mockAccountRecovery = createMockRepository<
		AccountRecoveryEntity,
		AccountRecoveryQuery
	>();

	const serviceAccountToken = new AccountTokenService(
		mockAccountToken.repository,
	);

	const serviceUser = new UserService(
		mockUser.repository,
		serviceAccountToken,
	);

	const serviceAccountRecovery = new AccountRecoveryService(
		mockAccountRecovery.repository,
	);

	const serviceAccountEmailService = new AccountEmailService();

	const serviceAccount = new AccountService(
		serviceUser,
		serviceAccountRecovery,
		serviceAccountEmailService,
	);

	it('encryptPassword should return a hashed string', async () => {
		const result = await encryptPassword('plain');

		expect(result).toBeDefined();
		expect(typeof result).toBe('string');
		expect(result).not.toBe('plain');
	});

	it('checkPassword should return true when password matches', async () => {
		const hashed = await encryptPassword('secret');

		const result = await serviceAccount.checkPassword('secret', hashed);

		expect(result).toBe(true);
	});

	it('checkPassword should return false when password does not match', async () => {
		const hashed = await encryptPassword('secret');

		const result = await serviceAccount.checkPassword('wrong', hashed);

		expect(result).toBe(false);
	});

	it('updatePassword should call userService.update', async () => {
		const user = getUserEntityMock();

		jest.spyOn(serviceUser, 'update').mockResolvedValue(user);

		jest.spyOn(
			serviceAccountRecovery,
			'removeAccountRecoveryForUser',
		).mockResolvedValue(undefined);

		await serviceAccount.updatePassword(user, 'newPassword');

		expect(serviceUser.update).toHaveBeenCalled();
	});

	it('register should throw when email already used (active user)', async () => {
		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});

		await expect(
			serviceAccount.register({
				name: 'John',
				email: 'john@example.com',
				password: 'Secret@1',
				password_confirm: 'Secret@1',
				language: 'en',
			}),
		).rejects.toThrow(BadRequestError);
	});

	it('register should throw when email pending', async () => {
		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
		});

		await expect(
			serviceAccount.register({
				name: 'John',
				email: 'john@example.com',
				password: 'Secret@1',
				password_confirm: 'Secret@1',
				language: 'en',
			}),
		).rejects.toThrow(CustomError);
	});

	it('register should call createRegister when email not exists', async () => {
		jest.spyOn(serviceUser, 'findByEmail').mockResolvedValue(null);

		const user = getUserEntityMock();

		jest.spyOn(serviceUser, 'createRegister').mockResolvedValue(user);

		const result = await serviceAccount.register({
			name: 'John',
			email: 'john@example.com',
			password: 'Secret@1',
			password_confirm: 'Secret@1',
			language: 'en',
		});

		expect(serviceUser.createRegister).toHaveBeenCalledWith({
			name: 'John',
			email: 'john@example.com',
			password: 'Secret@1',
			language: 'en',
		});
		expect(result).toBe(user);
	});

	it('createConfirmationToken should throw when user has no id or email', () => {
		expect(() =>
			serviceAccount.createConfirmationToken({ id: mockId(1) } as never),
		).toThrow();
		expect(() =>
			serviceAccount.createConfirmationToken({
				email: 'a@b.com',
			} as never),
		).toThrow();
	});

	it('createConfirmationToken should return token and expire_at', () => {
		const user = { id: mockId(1), email: 'u@example.com' };

		const result = serviceAccount.createConfirmationToken(user);

		expect(result).toHaveProperty('token');
		expect(result).toHaveProperty('expire_at');
		expect(result.token).toBeDefined();
		expect(result.expire_at).toBeInstanceOf(Date);
	});

	it('processEmailConfirmCreate should call accountEmailService.sendEmailConfirmCreate', () => {
		jest.spyOn(serviceAccount, 'createConfirmationToken').mockReturnValue({
			token: 'xxx',
			expire_at: createFutureDate(86400),
		});

		jest.spyOn(
			serviceAccountEmailService,
			'sendEmailConfirmCreate',
		).mockImplementation(() => Promise.resolve());

		serviceAccount.processEmailConfirmCreate(getUserEntityMock());

		expect(
			serviceAccountEmailService.sendEmailConfirmCreate,
		).toHaveBeenCalled();
	});

	it('processRegistration should call sendWelcomeEmail when status ACTIVE', () => {
		const user = {
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		};

		jest.spyOn(
			serviceAccountEmailService,
			'sendWelcomeEmail',
		).mockImplementation(() => Promise.resolve());

		serviceAccount.processRegistration(user);

		expect(
			serviceAccountEmailService.sendWelcomeEmail,
		).toHaveBeenCalledWith(user);
	});

	it('processRegistration should call processEmailConfirmCreate when status PENDING', () => {
		const user = {
			id: mockId(1),
			name: 'John',
			email: 'j@example.com',
			language: 'en',
			status: UserStatusEnum.PENDING,
		};

		jest.spyOn(
			serviceAccount,
			'processEmailConfirmCreate',
		).mockImplementation(() => undefined);

		serviceAccount.processRegistration(user);

		expect(serviceAccount.processEmailConfirmCreate).toHaveBeenCalledWith(
			user,
		);
	});

	it('determineConfirmationTokenPayload should throw on invalid token', () => {
		expect(() =>
			serviceAccount.determineConfirmationTokenPayload('invalid-token'),
		).toThrow(BadRequestError);
	});
});
