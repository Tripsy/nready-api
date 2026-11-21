import type { ConfirmationTokenPayload } from '@/features/account/account.service';
import type AccountRecoveryEntity from '@/features/account/account-recovery.entity';
import type AccountTokenEntity from '@/features/account/account-token.entity';
import type { AuthValidToken } from '@/features/account/account-token.service';
import { createFutureDate, createPastDate } from '@/helpers/date.helper';
import { mockId, mockUuid } from '@/tests/mocks/uuid.mock';

export function getAccountTokenMock(): AccountTokenEntity {
	return {
		id: mockId(1),
		user_id: mockId(1),
		ident: mockUuid(),
		created_at: createPastDate(28800),
		metadata: { 'user-agent': 'test-agent' },
		used_at: createPastDate(14400),
		expire_at: createFutureDate(14400),
	};
}

export function getAccountRecoveryMock(): AccountRecoveryEntity {
	return {
		id: mockId(1),
		user_id: mockId(1),
		ident: mockUuid(),
		created_at: createPastDate(28800),
		used_at: createPastDate(14400),
		expire_at: createFutureDate(14400),
	};
}

export function getAuthValidTokenMock(): AuthValidToken {
	return {
		ident: 'some_ident',
		label: 'Windows',
		used_at: createPastDate(7200),
		used_now: true,
	};
}

export function getAuthActiveTokenMock(): AccountTokenEntity {
	return {
		id: mockId(1),
		user_id: mockId(1),
		ident: mockUuid(),
		created_at: createPastDate(28800),
		used_at: createPastDate(14400),
		expire_at: createFutureDate(14400),
	};
}

export function getConfirmationTokenPayloadMock(): ConfirmationTokenPayload {
	return {
		user_id: mockId(1),
		user_email: 'john.doe@example.com',
	};
}

export const accountInputPayloads = {
	register: {
		name: 'John Doe',
		email: 'john.doe@example.com',
		password: 'Secure@123',
		password_confirm: 'Secure@123',
		language: 'en',
	},
	login: {
		email: 'john.doe@example.com',
		password: 'Secure@123',
	},
	oauthLogin: {
		// The controller merges `provider` from the path before validating.
		provider: 'google',
		code: 'provider_authorization_code',
		redirect_uri: 'http://nready-ui.test/auth/callback/google',
		language: 'en',
	},
	oauthUnlink: {
		provider: 'google',
	},
	passwordRecover: {
		email: 'john.doe@example.com',
	},
	passwordRecoverChange: {
		// The controller merges `ident` from the path before validating, so the payload
		// the validator sees always carries it.
		ident: mockUuid(),
		password: 'Secure@123',
		password_confirm: 'Secure@123',
	},
	passwordUpdate: {
		password_current: 'Secure@123',
		password_new: 'NewStuff@123',
		password_confirm: 'NewStuff@123',
	},
	emailConfirmSend: {
		email: 'john.doe@example.com',
	},
	emailUpdate: {
		email_new: 'john.doe@example.com',
	},
	removeToken: {
		ident: mockUuid(),
	},
	meEdit: {
		name: 'John Doe',
		language: 'en',
	},
	meDelete: {
		password_current: 'Secure@123',
	},
};
