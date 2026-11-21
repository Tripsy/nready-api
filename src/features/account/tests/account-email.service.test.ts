import { expect, jest } from '@jest/globals';
import type { EmailTemplate } from '@/features/template/template.entity';
import { formatDate } from '@/helpers/date.helper';
import { mockId } from '@/tests/mocks/uuid.mock';

/*
 * `AccountEmailService` collaborates with two module-level functions rather than injected
 * dependencies, so they are replaced at the module level. Under the ESM preset a plain
 * `jest.mock()` does not hoist, hence `unstable_mockModule` plus a dynamic import of the
 * service afterwards - the mock has to be registered before the module is evaluated.
 */
const loadEmailTemplate =
	jest.fn<(label: string, language: string) => Promise<EmailTemplate>>();
const queueEmail =
	jest.fn<
		(
			template: EmailTemplate,
			to: { name: string; address: string },
		) => Promise<void>
	>();

jest.unstable_mockModule('@/providers/email.provider', () => ({
	loadEmailTemplate,
	queueEmail,
}));

const { AccountEmailService } = await import(
	'@/features/account/account-email.service'
);

function getTemplateMock(): EmailTemplate {
	return {
		id: mockId(1),
		language: 'en',
		content: {
			subject: 'Subject',
			html: '<p>Body</p>',
		},
	};
}

function getUserMock() {
	return {
		id: mockId(1),
		name: 'John Doe',
		email: 'john.doe@example.com',
		language: 'en',
	};
}

/**
 * Asserts the queued mail without passing `EmailTemplate` through a jest matcher -
 * `toHaveBeenCalledWith` on that type trips TS2589 ("type instantiation is excessively
 * deep"), so the call is destructured and each half checked separately.
 */
function expectQueuedTo(
	expectedTemplate: EmailTemplate,
	expectedTo: { name: string; address: string },
) {
	expect(queueEmail).toHaveBeenCalledTimes(1);

	const [sentTemplate, sentTo] = queueEmail.mock.calls[0];

	expect(sentTemplate).toBe(expectedTemplate);
	expect(sentTo).toEqual(expectedTo);
}

describe('AccountEmailService', () => {
	const service = new AccountEmailService();

	let template: EmailTemplate;

	beforeEach(() => {
		jest.clearAllMocks();

		template = getTemplateMock();

		loadEmailTemplate.mockResolvedValue(template);
		queueEmail.mockResolvedValue();
	});

	describe('sendEmailConfirmUpdate', () => {
		const expireAt = new Date('2026-01-15T14:30:00.000Z');

		it('should load the email-confirm-update template in the user language', async () => {
			await service.sendEmailConfirmUpdate(
				getUserMock(),
				'raw token',
				expireAt,
				'new@example.com',
			);

			expect(loadEmailTemplate).toHaveBeenCalledWith(
				'email-confirm-update',
				'en',
			);
		});

		it('should send to the NEW address, not the current one', async () => {
			const user = getUserMock();

			await service.sendEmailConfirmUpdate(
				user,
				'raw token',
				expireAt,
				'new@example.com',
			);

			// The whole point of this mail is to prove control of the new address -
			// delivering it to the existing one would let an attacker confirm a change
			// the account owner never sees.
			expectQueuedTo(template, {
				name: user.name,
				address: 'new@example.com',
			});
		});

		it('should URI-encode the token', async () => {
			await service.sendEmailConfirmUpdate(
				getUserMock(),
				'a+b/c=d e',
				expireAt,
				'new@example.com',
			);

			// The token goes into a confirmation URL; an unencoded `+` or `/` would be
			// mangled in transit and the link would fail.
			expect(template.content.vars).toEqual({
				name: 'John Doe',
				token: 'a%2Bb%2Fc%3Dd%20e',
				expire_at: formatDate(expireAt, 'date-time'),
			});
		});
	});

	describe('sendEmailConfirmCreate', () => {
		const expireAt = new Date('2026-01-15T14:30:00.000Z');

		it('should load its template and send to the user address', async () => {
			const user = getUserMock();

			await service.sendEmailConfirmCreate(user, 'raw+token', expireAt);

			expect(loadEmailTemplate).toHaveBeenCalledWith(
				'email-confirm-create',
				'en',
			);

			expect(template.content.vars).toEqual({
				name: user.name,
				token: 'raw%2Btoken',
				expire_at: formatDate(expireAt, 'date-time'),
			});

			expectQueuedTo(template, {
				name: user.name,
				address: user.email,
			});
		});
	});

	describe('sendWelcomeEmail', () => {
		it('should load the welcome template and pass only the name', async () => {
			const user = getUserMock();

			await service.sendWelcomeEmail(user);

			expect(loadEmailTemplate).toHaveBeenCalledWith(
				'email-welcome',
				'en',
			);

			expect(template.content.vars).toEqual({ name: user.name });

			expectQueuedTo(template, {
				name: user.name,
				address: user.email,
			});
		});
	});

	describe('sendEmailPasswordRecover', () => {
		it('should pass the recovery ident and expiry through', async () => {
			const user = getUserMock();
			const token = {
				ident: '123e4567-e89b-12d3-a456-426614174000',
				expire_at: new Date('2026-01-15T14:30:00.000Z'),
			};

			await service.sendEmailPasswordRecover(user, token);

			expect(loadEmailTemplate).toHaveBeenCalledWith(
				'password-recover',
				'en',
			);

			// `ident` is deliberately NOT encoded here - unlike the confirmation token it
			// is a bare uuid, so a change to that would show up as a diff.
			expect(template.content.vars).toEqual({
				name: user.name,
				ident: token.ident,
				expire_at: formatDate(token.expire_at, 'date-time'),
			});

			expectQueuedTo(template, {
				name: user.name,
				address: user.email,
			});
		});
	});

	describe('sendEmailPasswordChange', () => {
		it('should load the password-change template and notify the user', async () => {
			const user = getUserMock();

			await service.sendEmailPasswordChange(user);

			expect(loadEmailTemplate).toHaveBeenCalledWith(
				'password-change',
				'en',
			);

			expect(template.content.vars).toEqual({ name: user.name });

			expectQueuedTo(template, {
				name: user.name,
				address: user.email,
			});
		});
	});

	it('should render every template in the language the user asked for', async () => {
		const user = { ...getUserMock(), language: 'ro' };

		await service.sendWelcomeEmail(user);

		expect(loadEmailTemplate).toHaveBeenCalledWith('email-welcome', 'ro');
	});
});
