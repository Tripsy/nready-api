import jwt from 'jsonwebtoken';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError } from '@/exceptions';
import type { AccountValidator } from '@/features/account/account.validator';
import {
	type AccountEmailService,
	accountEmailService,
} from '@/features/account/account-email.service';
import {
	type AccountRecoveryService,
	accountRecoveryService,
} from '@/features/account/account-recovery.service';
import type UserEntity from '@/features/user/user.entity';
import { type UserStatus, UserStatusEnum } from '@/features/user/user.entity';
import { type UserService, userService } from '@/features/user/user.service';
import { runInBackground } from '@/helpers/background.helper';
import { createCurrentDate, createFutureDate } from '@/helpers/date.helper';
import { comparePassword } from '@/helpers/security.helper';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export type ConfirmationTokenPayload = {
	user_id: EntityId;
	user_email: string;
	user_email_new?: string;
};

export class AccountService {
	constructor(
		private userService: UserService,
		private accountRecoveryService: AccountRecoveryService,
		private accountEmailService: AccountEmailService,
	) {}

	/**
	 * @description Checks if a password matches a hashed password
	 */
	public async checkPassword(
		password: string,
		hashedPassword: string,
	): Promise<boolean> {
		return comparePassword(password, hashedPassword);
	}

	/**
	 * @description Updates a user password and drops the user's recovery tokens
	 *
	 * `keepRecoveryId` spares one row - the recovery link currently being redeemed, which
	 * `passwordRecoverChange` then marks as used. Every other outstanding recovery for this
	 * user dies here: once the password changes, any link requested beforehand must stop
	 * working, including ones requested by someone else.
	 */
	public async updatePassword(
		user: UserEntity,
		password: string,
		keepRecoveryId?: EntityId,
	): Promise<void> {
		user.password = password; // Subscriber hashes it
		user.password_updated_at = createCurrentDate();

		await this.userService.update(user);

		await this.accountRecoveryService.removeAccountRecoveryForUser(
			user.id,
			keepRecoveryId,
		);
	}

	public async register(
		data: ValidatorOutput<AccountValidator, 'register'>,
	): Promise<UserEntity> {
		const existing = await this.userService.findByEmail(data.email);

		if (existing) {
			if (
				!existing.deleted_at &&
				existing.status === UserStatusEnum.PENDING
			) {
				throw new CustomError(
					409,
					lang('account.error.pending_account'),
				);
			} else {
				throw new BadRequestError(
					lang('account.error.email_already_used'),
				);
			}
		}

		return this.userService.createRegister({
			name: data.name,
			email: data.email,
			password: data.password,
			language: data.language,
		});
	}

	/**
	 * This method has a double utility:
	 *  - creates a JWT token which is used to confirm the email address of the user on account creation
	 *  - creates a JWT token which is used to confirm the email address of the user on email update
	 *
	 * @param user
	 * @param email_new
	 */
	public createConfirmationToken(
		user: Partial<UserEntity> & {
			id: EntityId;
			email: string;
		},
		email_new?: string,
	): {
		token: string;
		expire_at: Date;
	} {
		if (!user.id || !user.email) {
			throw new Error(
				'User object must contain both `id` and `email` properties.',
			);
		}

		const payload: ConfirmationTokenPayload = {
			user_id: user.id,
			user_email: user.email,
			user_email_new: email_new,
		};

		const token = jwt.sign(
			payload,
			Configuration.get('user.emailConfirmationSecret'),
			{
				expiresIn:
					(Configuration.get(
						'user.emailConfirmationExpiresIn',
					) as number) * 86400,
			},
		);

		const expire_at = createFutureDate(
			Configuration.get('user.emailConfirmationExpiresIn') * 86400,
		);

		return { token, expire_at };
	}

	public processEmailConfirmCreate(
		user: Partial<UserEntity> & {
			id: EntityId;
			name: string;
			email: string;
			language: string;
			status: UserStatus;
		},
	): void {
		const { token, expire_at } = this.createConfirmationToken(user);

		runInBackground(
			this.accountEmailService.sendEmailConfirmCreate(
				user,
				token,
				expire_at,
			),
			`Failed to send the account-confirmation email to user #${user.id}`,
		);
	}

	public processRegistration(
		user: Partial<UserEntity> & {
			id: EntityId;
			name: string;
			email: string;
			language: string;
			status: UserStatus;
		},
	): void {
		switch (user.status) {
			case UserStatusEnum.ACTIVE:
				runInBackground(
					this.accountEmailService.sendWelcomeEmail(user),
					`Failed to send the welcome email to user #${user.id}`,
				);
				break;
			case UserStatusEnum.PENDING:
				// Synchronous - it wraps its own send in `runInBackground`.
				this.processEmailConfirmCreate(user);
				break;
		}
	}

	/**
	 * @description Verify confirmation token and return payload
	 * @param token
	 */
	public determineConfirmationTokenPayload(
		token: string,
	): ConfirmationTokenPayload {
		try {
			return jwt.verify(
				token,
				Configuration.get('user.emailConfirmationSecret'),
			) as ConfirmationTokenPayload;
		} catch {
			throw new BadRequestError(
				lang('account.error.invalid_confirmation_token'),
			);
		}
	}
}

export const accountService = new AccountService(
	userService,
	accountRecoveryService,
	accountEmailService,
);
