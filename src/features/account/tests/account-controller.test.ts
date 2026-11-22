import { jest } from '@jest/globals';

import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import { NotFoundError } from '@/exceptions';
import {
	getAccountTokenMock,
	getAuthValidTokenMock,
	getConfirmationTokenPayloadMock,
} from '@/features/account/account.mock';
import { accountPolicy } from '@/features/account/account.policy';
import accountRoutes from '@/features/account/account.routes';
import { accountService } from '@/features/account/account.service';
import { accountRecoveryService } from '@/features/account/account-recovery.service';
import { accountTokenService } from '@/features/account/account-token.service';
import { UserStatusEnum } from '@/features/user/user.entity';
import { getUserEntityMock } from '@/features/user/user.mock';
import { userService } from '@/features/user/user.service';
import { createFutureDate, createPastDate } from '@/helpers/date.helper';
import { withDebugResponse } from '@/tests/jest-controller.setup';
import { mockConfig, mockUuid } from '@/tests/mocks/helpers.mock';
import {
	isAuthenticatedSpy,
	notAuthenticatedSpy,
} from '@/tests/mocks/policies.mock';
import { mockAccountEmailService } from '@/tests/mocks/services.mock';
import { mockId } from '@/tests/mocks/uuid.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(async () => {
	jest.clearAllMocks();
	jest.resetModules();
});

const controller = 'AccountController';
const basePath = (await accountRoutes()).basePath;

describe(`${controller} - register`, () => {
	const link = `${basePath}/register`;

	it('should fail if authenticated', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountService, 'register').mockResolvedValue(
			getUserEntityMock(),
		);

		const response = await request(app).post(link).send({
			name: 'John Doe',
			email: 'john.doe@example.com',
			password: 'Secure@123',
			password_confirm: 'Secure@123',
			language: 'en',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.register',
			);
			expect(response.body.data).toHaveProperty(
				'id',
				getUserEntityMock().id,
			);
		}, response);
	});
});

describe(`${controller} - login`, () => {
	const link = `${basePath}/login`;

	it('should fail if authenticated', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return not authorized', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});

		const response = await request(app).post(link).send({
			email: getUserEntityMock().email,
			password: 'Secure@123',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(401);
			expect(response.body).toHaveProperty('success', false);
		}, response);
	});

	it('should return error due max active sessions', async () => {
		notAuthenticatedSpy(accountPolicy);

		const mockAuthValidToken = getAuthValidTokenMock();

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});

		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(true);
		jest.spyOn(accountTokenService, 'getAuthValidTokens').mockResolvedValue(
			[mockAuthValidToken, mockAuthValidToken],
		);

		const response = await request(app).post(link).send({
			email: getUserEntityMock().email,
			password: 'Secure@123',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(403);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.max_active_sessions',
			);
		}, response);
	});

	it('should return success', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});

		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(true);
		jest.spyOn(accountTokenService, 'getAuthValidTokens').mockResolvedValue(
			[],
		);
		jest.spyOn(accountTokenService, 'setupAuthToken').mockResolvedValue(
			'some_token',
		);

		const response = await request(app).post(link).send({
			email: getUserEntityMock().email,
			password: 'Secure@123',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.login',
			);
			expect(response.body.data).toHaveProperty('token');
		}, response);
	});
});

describe(`${controller} - removeToken`, () => {
	const link = `${basePath}/token`;

	it('should return success', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(
			accountTokenService,
			'removeAccountTokenByIdent',
		).mockResolvedValue(undefined);

		const response = await request(app).delete(link).send({
			ident: mockUuid(),
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.token_deleted',
			);
		}, response);
	});
});

describe(`${controller} - logout`, () => {
	const link = `${basePath}/logout`;

	it('should fail if not authenticated', async () => {
		notAuthenticatedSpy(accountPolicy);

		const response = await request(app).delete(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		const mockAccountToken = getAccountTokenMock();

		jest.spyOn(
			accountTokenService,
			'getAuthTokenFromHeaders',
		).mockReturnValue('random_string');
		jest.spyOn(accountTokenService, 'findByToken').mockResolvedValue(
			mockAccountToken,
		);
		jest.spyOn(
			accountTokenService,
			'removeAccountTokenByIdent',
		).mockResolvedValue(undefined);

		const response = await request(app).delete(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.logout',
			);
		}, response);
	});
});

describe(`${controller} - passwordRecover`, () => {
	const link = `${basePath}/password-recover`;

	it('should fail if authenticated', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return error due to recovery attempts exceeded', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});
		jest.spyOn(
			accountRecoveryService,
			'countRecoveryAttempts',
		).mockResolvedValue(5);

		const response = await request(app).post(link).send({
			email: 'john.doe@example.com',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(425);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.recovery_attempts_exceeded',
			);
		}, response);
	});

	it('should return success', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});
		jest.spyOn(
			accountRecoveryService,
			'countRecoveryAttempts',
		).mockResolvedValue(0);
		jest.spyOn(accountRecoveryService, 'setupRecovery').mockResolvedValue([
			mockUuid(),
			createFutureDate(28800),
		]);
		mockAccountEmailService();

		const response = await request(app).post(link).send({
			email: 'john.doe@example.com',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.password_recover',
			);
		}, response);
	});
});

describe(`${controller} - passwordRecoverChange`, () => {
	const link = `${basePath}/password-recover-change/${mockUuid()}`;
	const mockAccountRecovery = getAccountTokenMock();

	it('should fail if authenticated', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return error - account recovery token already used', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue(
			mockAccountRecovery,
		);

		const response = await request(app).post(link).send({
			password: 'Secure@123!',
			password_confirm: 'Secure@123!',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.recovery_token_used',
			);
		}, response);
	});

	it('should return error - account recovery token expired', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue({
			...mockAccountRecovery,
			used_at: null,
			expire_at: createPastDate(14400),
		});

		const response = await request(app).post(link).send({
			password: 'Secure@123!',
			password_confirm: 'Secure@123!',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.recovery_token_expired',
			);
		}, response);
	});

	it('should return success', async () => {
		notAuthenticatedSpy(accountPolicy);

		mockConfig('user.recoveryEnableMetadataCheck', false);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue({
			...mockAccountRecovery,
			used_at: null,
		});

		jest.spyOn(userService, 'findById').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});
		const updatePasswordSpy = jest
			.spyOn(accountService, 'updatePassword')
			.mockResolvedValue(undefined);
		const markAsUsedSpy = jest
			.spyOn(accountRecoveryService, 'markAsUsed')
			.mockResolvedValue(undefined);

		mockAccountEmailService();

		const response = await request(app).post(link).send({
			password: 'Secure@123!',
			password_confirm: 'Secure@123!',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.password_changed',
			);
		}, response);

		/*
		 * The redeemed row has to survive `updatePassword` for `markAsUsed` to land on it -
		 * hence the third argument. Without it the row is deleted first and the follow-up
		 * write re-inserts it with a null `user_id`, turning a successful recovery into a
		 * 500.
		 */
		expect(updatePasswordSpy).toHaveBeenCalledWith(
			expect.anything(),
			'Secure@123!',
			mockAccountRecovery.id,
		);
		expect(markAsUsedSpy).toHaveBeenCalledWith(mockAccountRecovery.id);
	});
});

describe(`${controller} - passwordUpdate`, () => {
	const link = `${basePath}/password-update`;

	it('should fail if not authenticated', async () => {
		notAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return error - invalid_password', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);
		jest.spyOn(userService, 'findByIdWithPassword').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});
		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(false);

		const response = await request(app).post(link).send({
			password_current: 'some_password',
			password_new: 'Secure@123!',
			password_confirm: 'Secure@123!',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);
		jest.spyOn(userService, 'findByIdWithPassword').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
		});
		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(true);
		jest.spyOn(accountService, 'updatePassword').mockResolvedValue(
			undefined,
		);
		jest.spyOn(accountTokenService, 'setupAuthToken').mockResolvedValue(
			'some_token',
		);

		mockAccountEmailService();

		const response = await request(app).post(link).send({
			password_current: 'some_password',
			password_new: 'Secure@123!',
			password_confirm: 'Secure@123!',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.password_updated',
			);
		}, response);
	});
});

describe(`${controller} - emailConfirm`, () => {
	const link = `${basePath}/email-confirm/some_token_value`;
	const mockConfirmationTokenPayload = getConfirmationTokenPayloadMock();

	it('should fail - invalid_confirmation_token', async () => {
		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.invalid_confirmation_token',
			);
		}, response);
	});

	it('should fail - confirmation_token_not_authorized', async () => {
		jest.spyOn(
			accountService,
			'determineConfirmationTokenPayload',
		).mockReturnValue(mockConfirmationTokenPayload);

		jest.spyOn(userService, 'findById').mockResolvedValue({
			...getUserEntityMock(),
			email: 'not_matching@example.com',
		});

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.confirmation_token_not_authorized',
			);
		}, response);
	});

	it('should return success', async () => {
		jest.spyOn(
			accountService,
			'determineConfirmationTokenPayload',
		).mockReturnValue(mockConfirmationTokenPayload);

		jest.spyOn(userService, 'findById').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
		});

		jest.spyOn(userService, 'update').mockResolvedValue(
			getUserEntityMock(),
		);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.email_confirmed',
			);
		}, response);
	});
});

describe(`${controller} - emailConfirmSend`, () => {
	const link = `${basePath}/email-confirm-send`;

	it('should fail if authenticated', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should fail - account not found', async () => {
		jest.spyOn(userService, 'findByEmail').mockResolvedValue(null);

		const response = await request(app).post(link).send({
			email: getUserEntityMock().email,
		});

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_found',
			);
		}, response);
	});

	it('should return success', async () => {
		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
		});
		jest.spyOn(accountService, 'processEmailConfirmCreate').mockReturnValue(
			undefined,
		);

		const response = await request(app).post(link).send({
			email: getUserEntityMock().email,
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.email_confirmation_sent',
			);
		}, response);
	});
});

describe(`${controller} - emailUpdate`, () => {
	const link = `${basePath}/email-update`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should fail - email_already_used', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue(
			getUserEntityMock(),
		);

		const response = await request(app).post(link).send({
			email_new: 'new-email@example.com',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(409);
			expect(response.body).toHaveProperty('success', false);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.email_already_used',
			);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue(null);
		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);
		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);
		jest.spyOn(accountService, 'createConfirmationToken').mockReturnValue({
			token: mockUuid(),
			expire_at: createFutureDate(864000),
		});
		mockAccountEmailService();

		const response = await request(app).post(link).send({
			email_new: 'new-email@example.com',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.email_update_request',
			);
		}, response);
	});
});

describe(`${controller} - meDetails`, () => {
	const link = `${basePath}/me`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).get(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});
});

describe(`${controller} - meSessions`, () => {
	const link = `${basePath}/me/sessions`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).get(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		const mockAuthValidToken = getAuthValidTokenMock();

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);
		jest.spyOn(accountTokenService, 'getAuthValidTokens').mockResolvedValue(
			[mockAuthValidToken],
		);

		const response = await request(app).get(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body.data).toHaveLength(1);
		}, response);
	});
});

describe(`${controller} - meEdit`, () => {
	const link = `${basePath}/me/edit`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);

		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);

		jest.spyOn(userService, 'update').mockResolvedValue(
			getUserEntityMock(),
		);

		const response = await request(app).post(link).send({
			name: 'New name',
			language: 'ro',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.edit',
			);
		}, response);
	});
});

describe(`${controller} - meDelete`, () => {
	const link = `${basePath}/me/delete`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).delete(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(
			getUserEntityMock().id,
		);
		jest.spyOn(userService, 'findByIdWithPassword').mockResolvedValue(
			getUserEntityMock(),
		);
		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(true);
		jest.spyOn(userService, 'delete').mockResolvedValue(undefined);

		const response = await request(app).delete(link).send({
			password_current: 'some_password',
		});

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body).toHaveProperty(
				'message',
				'account.success.delete',
			);
		}, response);
	});
});

/*
 * The blocks below target guard clauses that the happy-path tests above never reach -
 * "user gone", "wrong status", "token spent". They are the branches that decide whether a
 * request is refused, so an inverted condition here is an authorization hole rather than a
 * cosmetic bug.
 */
describe(`${controller} - login (rejection branches)`, () => {
	const link = `${basePath}/login`;
	const credentials = {
		email: 'john.doe@example.com',
		password: 'Secure@123',
	};

	it('should return 404 when the account does not exist', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue(null);

		const response = await request(app).post(link).send(credentials);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_found',
			);
		}, response);
	});

	it('should return 404 when the account is soft-deleted', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
			deleted_at: createPastDate(3600),
		});

		const response = await request(app).post(link).send(credentials);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_found',
			);
		}, response);
	});

	it('should return 409 for a pending account', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
			deleted_at: null,
		});

		const response = await request(app).post(link).send(credentials);

		// 409 rather than 404: the caller is told to confirm their email, which is
		// actionable, whereas an inactive account is deliberately indistinguishable
		// from a missing one.
		withDebugResponse(() => {
			expect(response.status).toBe(409);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.pending_account',
			);
		}, response);
	});

	it('should return 404 for an inactive account', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.INACTIVE,
			deleted_at: null,
		});

		const response = await request(app).post(link).send(credentials);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_active',
			);
		}, response);
	});
});

describe(`${controller} - logout (rejection branches)`, () => {
	const link = `${basePath}/logout`;

	it('should return 400 when no bearer token is present', async () => {
		isAuthenticatedSpy(accountPolicy);

		const response = await request(app).delete(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_logged_in',
			);
		}, response);
	});

	it('should return 400 when the token cannot be resolved', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(
			accountTokenService,
			'getAuthTokenFromHeaders',
		).mockReturnValue('some-token');

		jest.spyOn(accountTokenService, 'findByToken').mockRejectedValue(
			new Error('not found'),
		);

		const response = await request(app).delete(link).send();

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_logged_in',
			);
		}, response);
	});
});

describe(`${controller} - passwordRecover (rejection branches)`, () => {
	const link = `${basePath}/password-recover`;
	const payload = { email: 'john.doe@example.com' };

	it('should return 404 when the account does not exist', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue(null);

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_found',
			);
		}, response);
	});

	it('should return 404 when the account is not active', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.PENDING,
			deleted_at: null,
		});

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_active',
			);
		}, response);
	});
});

describe(`${controller} - passwordRecoverChange (rejection branches)`, () => {
	const link = `${basePath}/password-recover-change/${mockUuid()}`;
	const payload = {
		password: 'Secure@123!',
		password_confirm: 'Secure@123!',
	};

	it('should return 404 when the recovery token is unknown', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue(
			null,
		);

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.recovery_token_not_authorized',
			);
		}, response);
	});

	it('should reject when the metadata check fails', async () => {
		notAuthenticatedSpy(accountPolicy);

		mockConfig('user.recoveryEnableMetadataCheck', true);

		// Recovery row captured a different user-agent than the one replaying the link -
		// this is the guard that stops a leaked recovery URL being used from elsewhere.
		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue({
			...getAccountTokenMock(),
			used_at: null,
			expire_at: createFutureDate(3600),
			metadata: { 'user-agent': 'some-other-browser' },
		} as never);

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.recovery_token_not_authorized',
			);
		}, response);
	});

	it('should return 404 when the recovery row points at a missing user', async () => {
		notAuthenticatedSpy(accountPolicy);

		mockConfig('user.recoveryEnableMetadataCheck', false);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue({
			...getAccountTokenMock(),
			used_at: null,
			expire_at: createFutureDate(3600),
		} as never);

		// `userService.findById` resolves through `firstOrFail()`, so a missing row
		// arrives as a thrown NotFoundError rather than a null return - the controller's
		// own `if (!user)` guard below it is unreachable.
		jest.spyOn(userService, 'findById').mockRejectedValue(
			new NotFoundError('user.error.not_found'),
		);

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
		}, response);
	});

	it('should return 404 when the user is no longer active', async () => {
		notAuthenticatedSpy(accountPolicy);

		mockConfig('user.recoveryEnableMetadataCheck', false);

		jest.spyOn(accountRecoveryService, 'findByIdent').mockResolvedValue({
			...getAccountTokenMock(),
			used_at: null,
			expire_at: createFutureDate(3600),
		} as never);

		jest.spyOn(userService, 'findById').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.INACTIVE,
		});

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(404);
			expect(response.body).toHaveProperty(
				'message',
				'account.error.not_active',
			);
		}, response);
	});
});

describe(`${controller} - emailConfirmSend (rejection branches)`, () => {
	const link = `${basePath}/email-confirm-send`;
	const payload = { email: 'john.doe@example.com' };

	it('should return 403 when the account is not pending', async () => {
		notAuthenticatedSpy(accountPolicy);

		jest.spyOn(userService, 'findByEmail').mockResolvedValue({
			...getUserEntityMock(),
			status: UserStatusEnum.ACTIVE,
			deleted_at: null,
		});

		const response = await request(app).post(link).send(payload);

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});
});

describe(`${controller} - authenticated actions without a resolvable id`, () => {
	// `requiredAuth` passes but `getId` yields nothing - a malformed auth context. Each
	// action guards this independently, and all of them must answer 401 rather than
	// continue with an undefined user id.
	const cases: [string, 'get' | 'post', string][] = [
		['meSessions', 'get', `${basePath}/me/sessions`],
		['meEdit', 'post', `${basePath}/me/edit`],
	];

	cases.forEach(([name, method, link]) => {
		it(`${name}() should return 401`, async () => {
			isAuthenticatedSpy(accountPolicy);

			jest.spyOn(accountPolicy, 'getId').mockReturnValue(undefined);

			const response = await request(app)
				[method](link)
				.send({ name: 'John Doe' });

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});
	});
});

describe(`${controller} - meEdit / meDelete (rejection branches)`, () => {
	it('meEdit() should return 404 when the user record is gone', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(mockId(1));

		// Same as above: the 404 comes from `firstOrFail()`, not from the controller.
		jest.spyOn(userService, 'findById').mockRejectedValue(
			new NotFoundError('user.error.not_found'),
		);

		const response = await request(app)
			.post(`${basePath}/me/edit`)
			.send({ name: 'John Doe' });

		withDebugResponse(() => {
			expect(response.status).toBe(404);
		}, response);
	});

	it('meDelete() should return 400 when the current password is wrong', async () => {
		isAuthenticatedSpy(accountPolicy);

		jest.spyOn(accountPolicy, 'getId').mockReturnValue(mockId(1));
		jest.spyOn(userService, 'findByIdWithPassword').mockResolvedValue(
			getUserEntityMock(),
		);
		jest.spyOn(accountService, 'checkPassword').mockResolvedValue(false);

		const response = await request(app)
			.delete(`${basePath}/me/delete`)
			.send({ password_current: 'WrongPass@123' });

		withDebugResponse(() => {
			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty('errors');
		}, response);
	});
});
