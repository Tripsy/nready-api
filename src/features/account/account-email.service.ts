import type AccountRecoveryEntity from '@/features/account/account-recovery.entity';
import type UserEntity from '@/features/user/user.entity';
import { formatDate } from '@/helpers/date.helper';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';
import type { EntityId } from '@/shared/types/entity-id.type';

export class AccountEmailService {
	public async sendEmailConfirmUpdate(
		user: Partial<UserEntity> & {
			id: EntityId;
			name: string;
			email: string;
			language: string;
		},
		token: string,
		expire_at: Date,
		email_new: string,
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			'email-confirm-update',
			user.language,
		);

		emailTemplate.content.vars = {
			name: user.name,
			token: encodeURIComponent(token),
			expire_at: formatDate(expire_at, 'date-time') as string,
		};

		await queueEmail(emailTemplate, {
			name: user.name,
			address: email_new,
		});
	}

	public async sendEmailConfirmCreate(
		user: Partial<UserEntity> & {
			id: EntityId;
			name: string;
			email: string;
			language: string;
		},
		token: string,
		expire_at: Date,
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			'email-confirm-create',
			user.language,
		);

		emailTemplate.content.vars = {
			name: user.name,
			token: encodeURIComponent(token),
			expire_at: formatDate(expire_at, 'date-time') as string,
		};

		await queueEmail(emailTemplate, {
			name: user.name,
			address: user.email,
		});
	}

	public async sendWelcomeEmail(
		user: Partial<UserEntity> & {
			name: string;
			email: string;
			language: string;
		},
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			'email-welcome',
			user.language,
		);

		emailTemplate.content.vars = {
			name: user.name,
		};

		await queueEmail(emailTemplate, {
			name: user.name,
			address: user.email,
		});
	}

	public async sendEmailPasswordRecover(
		user: Partial<UserEntity> & {
			name: string;
			email: string;
			language: string;
		},
		token: Partial<AccountRecoveryEntity> & {
			ident: string;
			expire_at: Date;
		},
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			'password-recover',
			user.language,
		);

		emailTemplate.content.vars = {
			name: user.name,
			ident: token.ident,
			expire_at: formatDate(token.expire_at, 'date-time') as string,
		};

		await queueEmail(emailTemplate, {
			name: user.name,
			address: user.email,
		});
	}

	public async sendEmailPasswordChange(
		user: Partial<UserEntity> & {
			name: string;
			email: string;
			language: string;
		},
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			'password-change',
			user.language,
		);

		emailTemplate.content.vars = {
			name: user.name,
		};

		await queueEmail(emailTemplate, {
			name: user.name,
			address: user.email,
		});
	}
}

export const accountEmailService = new AccountEmailService();
