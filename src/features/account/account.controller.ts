import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import {
	BadRequestError,
	CustomError,
	NotAllowedError,
	NotFoundError,
	UnauthorizedError,
} from '@/exceptions';
import {
	type AccountPolicy,
	accountPolicy,
} from '@/features/account/account.policy';
import {
	type AccountService,
	accountService,
} from '@/features/account/account.service';
import { AccountValidator } from '@/features/account/account.validator';
import {
	type AccountEmailService,
	accountEmailService,
} from '@/features/account/account-email.service';
import {
	type AccountOAuthService,
	accountOAuthService,
} from '@/features/account/account-oauth.service';
import {
	type AccountRecoveryService,
	accountRecoveryService,
} from '@/features/account/account-recovery.service';
import {
	type AccountTokenService,
	type AuthValidToken,
	accountTokenService,
} from '@/features/account/account-token.service';
import type UserEntity from '@/features/user/user.entity';
import { UserStatusEnum } from '@/features/user/user.entity';
import { type UserService, userService } from '@/features/user/user.service';
import asyncHandler from '@/helpers/async.handler';
import { runInBackground } from '@/helpers/background.helper';
import { createCurrentDate, createPastDate } from '@/helpers/date.helper';
import {
	compareMetaDataValue,
	tokenMetaData,
} from '@/helpers/meta-data.helper';
import { BaseController } from '@/shared/abstracts/controller.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

class AccountController extends BaseController {
	constructor(
		private policy: AccountPolicy,
		private validator: AccountValidator,
		private accountService: AccountService,
		private accountTokenService: AccountTokenService,
		private accountOAuthService: AccountOAuthService,
		private accountRecoveryService: AccountRecoveryService,
		private accountEmailService: AccountEmailService,
		private userService: UserService,
	) {
		super();
	}
	public register = asyncHandler(async (req: Request, res: Response) => {
		this.policy.notAuth(res.locals.auth);

		const data = this.validate(this.validator.register, req.body, res);

		data.language = data.language || res.locals.language;

		const entry = await this.accountService.register(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('account.success.register'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * Issues an auth token for an already-authenticated user, or refuses when the session
	 * cap is reached and hands back the list of tokens the client can revoke.
	 *
	 * Shared by password login and social login so both answer identically - the frontend
	 * has one code path for the 403-with-token-list case.
	 */
	private async issueAuthToken(
		user: Partial<UserEntity> & { id: EntityId },
		req: Request,
		res: Response,
		successMessage: string,
	): Promise<void> {
		const authValidTokens: AuthValidToken[] =
			await this.accountTokenService.getAuthValidTokens(user.id);

		const maxActiveSessions = Math.max(
			Configuration.get('user.maxActiveSessions'),
			1,
		); // Forced `1` as value - in case config value was set as 0 due to an error

		if (authValidTokens.length >= maxActiveSessions) {
			res.status(403); // Forbidden - client's identity is known to the server
			res.locals.output.message(
				lang('account.error.max_active_sessions'),
			);
			res.locals.output.data({
				authTokens: authValidTokens,
			});

			return;
		}

		const token = await this.accountTokenService.setupAuthToken(user, req);

		res.locals.output.message(successMessage);
		res.locals.output.data({
			token: token,
		});
	}

	public login = asyncHandler(async (req: Request, res: Response) => {
		this.policy.notAuth(res.locals.auth);

		const data = this.validate(this.validator.login, req.body, res);

		const user = await this.userService.findByEmail(data.email, undefined, [
			'id',
			'name',
			'email',
			'password',
			'status',
			'deleted_at',
		]);

		if (!user || user.deleted_at) {
			throw new NotFoundError(lang('account.error.not_found'));
		}

		if (user.status !== UserStatusEnum.ACTIVE) {
			switch (user.status) {
				case UserStatusEnum.PENDING:
					throw new CustomError(
						409,
						lang('account.error.pending_account'),
					);
				case UserStatusEnum.INACTIVE:
					throw new NotFoundError(lang('account.error.not_active'));
				default:
					throw new NotFoundError(lang('account.error.not_found'));
			}
		}

		// Social sign-in accounts have no password; without this they would fall through to
		// `checkPassword` and get the generic "invalid email or password", which sends the
		// user off to reset a password that does not exist.
		if (!user.password) {
			throw new BadRequestError(lang('account.error.oauth_only_account'));
		}

		const isValidPassword: boolean =
			await this.accountService.checkPassword(
				data.password,
				user.password,
			);

		if (!isValidPassword) {
			throw new UnauthorizedError(lang('account.error.not_authorized'));
		}

		await this.issueAuthToken(
			user,
			req,
			res,
			lang('account.success.login'),
		);

		res.json(res.locals.output);
	});

	/**
	 * Social sign-in. The frontend performs the provider redirect and posts the resulting
	 * authorization code here; the code is exchanged server-side so the client secret never
	 * reaches the browser.
	 *
	 * Registration and login are the same endpoint on purpose: from the provider's side
	 * they are indistinguishable, and the user has not told us which one they meant.
	 */
	public oauthLogin = asyncHandler(async (req: Request, res: Response) => {
		this.policy.notAuth(res.locals.auth);

		const data = this.validate(
			this.validator.oauthLogin,
			{
				...req.body,
				provider: req.params.provider,
			},
			res,
		);

		const user = await this.accountOAuthService.resolveUser(
			data.provider,
			data.code,
			data.redirect_uri,
			data.language || res.locals.language,
		);

		await this.issueAuthToken(
			user,
			req,
			res,
			lang('account.success.login'),
		);

		res.json(res.locals.output);
	});

	/**
	 * Lists the providers linked to the current account, for the account settings screen.
	 */
	public oauthList = asyncHandler(async (_req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		res.locals.output.data(
			await this.accountOAuthService.findForUser(user_id),
		);

		res.json(res.locals.output);
	});

	public oauthUnlink = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.oauthUnlink, req.params, res);

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		// `password` decides whether unlinking would leave the account with no way in at
		// all, so the row has to be loaded with that column.
		const user = await this.userService.findByIdWithPassword(user_id);

		await this.accountOAuthService.unlink(user, data.provider);

		res.locals.output.message(lang('account.success.oauth_unlinked'));

		res.json(res.locals.output);
	});

	/**
	 * With this endpoint account tokens can be removed
	 * It is allowed to be used authenticated or not
	 *
	 * Practical aspects:
	 *      - On login (with valid credentials), if too many sessions are active, a list of tokens will be returned
	 *        in the response -> front-end implementation can allow token(s) to be removed before login retry
	 *      - From his account page the user could see all active tokens and allow removal
	 */
	public removeToken = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.removeToken, req.body, res);

		await this.accountTokenService.removeAccountTokenByIdent(data.ident);

		res.locals.output.message(lang('account.success.token_deleted'));

		res.json(res.locals.output);
	});

	public logout = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		// Read the token from the request
		const token = this.accountTokenService.getAuthTokenFromHeaders(req);

		if (!token) {
			throw new BadRequestError(lang('account.error.not_logged_in'));
		}

		try {
			const activeToken =
				await this.accountTokenService.findByToken(token);

			if (activeToken) {
				await this.accountTokenService.removeAccountTokenByIdent(
					activeToken.ident,
				);
			}
		} catch {
			throw new BadRequestError(lang('account.error.not_logged_in'));
		}

		res.locals.output.message(lang('account.success.logout'));

		res.json(res.locals.output);
	});

	public passwordRecover = asyncHandler(
		async (req: Request, res: Response) => {
			this.policy.notAuth(res.locals.auth);

			const data = this.validate(
				this.validator.passwordRecover,
				req.body,
				res,
			);

			const user = await this.userService.findByEmail(
				data.email,
				undefined,
				['id', 'name', 'email', 'language', 'status', 'deleted_at'],
			);

			if (!user || user.deleted_at) {
				throw new NotFoundError(lang('account.error.not_found'));
			}

			if (user.status !== UserStatusEnum.ACTIVE) {
				throw new NotFoundError(lang('account.error.not_active'));
			}

			const countRecoveryAttempts: number =
				await this.accountRecoveryService.countRecoveryAttempts(
					user.id,
					createPastDate(6 * 60 * 60),
				);

			if (
				countRecoveryAttempts >=
				(Configuration.get(
					'user.recoveryAttemptsInLastSixHours',
				) as number)
			) {
				throw new CustomError(
					425,
					lang('account.error.recovery_attempts_exceeded'),
				);
			}

			const metadata = tokenMetaData(req);
			const [ident, expire_at] =
				await this.accountRecoveryService.setupRecovery(user, metadata);

			runInBackground(
				this.accountEmailService.sendEmailPasswordRecover(
					{
						...user,
						language: user.language || res.locals.language,
					},
					{
						ident: ident,
						expire_at: expire_at,
					},
				),
				`Failed to send the password-recovery email to user #${user.id}`,
			);

			res.locals.output.message(lang('account.success.password_recover'));

			res.json(res.locals.output);
		},
	);

	public passwordRecoverChange = asyncHandler(
		async (req: Request, res: Response) => {
			this.policy.notAuth(res.locals.auth);

			const data = this.validate(
				this.validator.passwordRecoverChange,
				{
					...req.body,
					ident: req.params.ident,
				},
				res,
			);

			const recovery = await this.accountRecoveryService.findByIdent(
				data.ident,
			);

			if (!recovery) {
				throw new NotFoundError(
					lang('account.error.recovery_token_not_authorized'),
				);
			}

			if (recovery.used_at) {
				throw new BadRequestError(
					lang('account.error.recovery_token_used'),
				);
			}

			if (recovery.expire_at < createCurrentDate()) {
				throw new BadRequestError(
					lang('account.error.recovery_token_expired'),
				);
			}

			if (Configuration.get('user.recoveryEnableMetadataCheck')) {
				// Validate metadata (e.g., user-agent check)
				if (
					!recovery.metadata ||
					!compareMetaDataValue(
						recovery.metadata,
						tokenMetaData(req),
						'user-agent',
					)
				) {
					throw new BadRequestError(
						lang('account.error.recovery_token_not_authorized'),
					);
				}
			}

			const user = await this.userService.findById(
				recovery.user_id,
				false,
			);

			if (user.status !== UserStatusEnum.ACTIVE) {
				throw new NotFoundError(lang('account.error.not_active'));
			}

			/*
			 * Drops every other outstanding recovery for this user but spares the row being
			 * redeemed, so the `used_at` write below has a row to land on.
			 *
			 * The password change goes first on purpose: if it throws, the link is still
			 * unused and the user can simply click it again. Marking the link used first
			 * would burn it on a failure that changed nothing.
			 */
			await this.accountService.updatePassword(
				user,
				data.password,
				recovery.id,
			);

			await this.accountRecoveryService.markAsUsed(recovery.id);

			runInBackground(
				this.accountEmailService.sendEmailPasswordChange({
					...user,
					language: user.language || res.locals.language,
				}),
				`Failed to send the password-change notice to user #${user.id}`,
			);

			res.locals.output.message(lang('account.success.password_changed'));

			res.json(res.locals.output);
		},
	);

	public passwordUpdate = asyncHandler(
		async (req: Request, res: Response) => {
			this.policy.requiredAuth(res.locals.auth);

			const data = this.validate(
				this.validator.passwordUpdate,
				req.body,
				res,
			);

			const user_id = this.policy.getId(res.locals.auth);

			if (!user_id) {
				throw new UnauthorizedError();
			}

			const user = await this.userService.findByIdWithPassword(user_id);

			// A social sign-in account has no current password to prove. Setting the first
			// one goes through password recovery, which proves ownership by email instead.
			if (!user.password) {
				throw new BadRequestError(
					lang('account.error.oauth_only_account'),
				);
			}

			const isValidPassword: boolean =
				await this.accountService.checkPassword(
					data.password_current,
					user.password,
				);

			if (!isValidPassword) {
				res.locals.output.errors([
					{
						password_current: lang(
							'account.validation.invalid_password',
						),
					},
				]);

				throw new BadRequestError();
			}

			// Update user password and remove all account tokens
			await this.accountService.updatePassword(user, data.password_new);

			// Generate a new token
			const token = await this.accountTokenService.setupAuthToken(
				user,
				req,
			);

			res.locals.output.message(lang('account.success.password_updated'));
			res.locals.output.data({
				token: token,
			});

			res.json(res.locals.output);
		},
	);

	/**
	 * This endpoint is used to confirm user email after account registration or email update
	 * It is allowed to be used authenticated or not
	 * ...and "Yes" - based on implementation (maybe auto-login after registration) - confirmation can take place even if logged in
	 */
	public emailConfirm = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.emailConfirm,
			req.params,
			res,
		);

		const token = decodeURIComponent(data.token);

		// Verify JWT and extract payload
		const confirmationTokenPayload =
			this.accountService.determineConfirmationTokenPayload(token);

		const user = await this.userService.findById(
			confirmationTokenPayload.user_id,
			false,
		);

		if (user.email !== confirmationTokenPayload.user_email) {
			throw new BadRequestError(
				lang('account.error.confirmation_token_not_authorized'),
			);
		}

		if (confirmationTokenPayload.user_email_new) {
			// Confirm procedure for email update
			user.email = confirmationTokenPayload.user_email_new;
			user.email_verified_at = createCurrentDate();

			await this.userService.update({
				id: user.id,
				email: user.email,
				email_verified_at: user.email_verified_at,
			});

			res.locals.output.message(lang('account.success.email_updated'));
		} else {
			// Confirm procedure for email confirmation
			switch (user.status) {
				case UserStatusEnum.ACTIVE:
					throw new BadRequestError(
						lang('account.error.already_active'),
					);
				case UserStatusEnum.INACTIVE:
					throw new NotAllowedError();
			}

			// Update user status
			user.status = UserStatusEnum.ACTIVE;
			user.email_verified_at = createCurrentDate();

			await this.userService.update({
				id: user.id,
				status: user.status,
				email_verified_at: user.email_verified_at,
			});

			res.locals.output.message(lang('account.success.email_confirmed'));
		}

		res.json(res.locals.output);
	});

	/**
	 * This endpoint is used to resend the confirmation email
	 */
	public emailConfirmSend = asyncHandler(
		async (req: Request, res: Response) => {
			this.policy.notAuth(res.locals.auth);

			const data = this.validate(
				this.validator.emailConfirmSend,
				req.body,
				res,
			);

			const user = await this.userService.findByEmail(
				data.email,
				undefined,
				['id', 'name', 'email', 'language', 'status', 'deleted_at'],
			);

			if (!user || user.deleted_at) {
				throw new BadRequestError(lang('account.error.not_found'));
			}

			if (user.status !== UserStatusEnum.PENDING) {
				throw new NotAllowedError();
			}

			this.accountService.processEmailConfirmCreate(user);

			res.locals.output.message(
				lang('account.success.email_confirmation_sent'),
			);

			res.json(res.locals.output);
		},
	);

	public emailUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.emailUpdate, req.body, res);

		const existingUser = await this.userService.findByEmail(data.email_new);

		// Return error if email already in use by another account
		if (existingUser) {
			throw new CustomError(
				409,
				lang('account.error.email_already_used'),
			);
		}

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		const user = await this.userService.findById(user_id, false);

		const { token, expire_at } =
			this.accountService.createConfirmationToken(user, data.email_new);

		runInBackground(
			this.accountEmailService.sendEmailConfirmUpdate(
				user,
				token,
				expire_at,
				data.email_new,
			),
			`Failed to send the email-update confirmation to user #${user.id}`,
		);

		res.locals.output.message(lang('account.success.email_update_request'));

		res.json(res.locals.output);
	});

	public meDetails = asyncHandler(async (_req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		res.locals.output.data(res.locals.auth);

		res.json(res.locals.output);
	});

	/**
	 * Returns a list of all active sessions for the current user
	 */
	public meSessions = asyncHandler(async (_req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		const authValidTokens: AuthValidToken[] =
			await this.accountTokenService.getAuthValidTokens(user_id);

		const tokens = authValidTokens.map((token) => {
			return {
				...token,
				used_now: token.ident === res.locals.auth?.activeToken,
			};
		});

		res.locals.output.data(tokens);

		res.json(res.locals.output);
	});

	public meEdit = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.meEdit, req.body, res);

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		// Throws NotFoundError when the account no longer exists. The entity itself is
		// not needed - the update targets `user_id` directly.
		await this.userService.findById(user_id, false);

		await this.userService.update({
			id: user_id,
			name: data.name,
			language: data.language,
		});

		res.locals.output.message(lang('account.success.edit'));

		res.json(res.locals.output);
	});

	public meDelete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.meDelete, req.body, res);

		const user_id = this.policy.getId(res.locals.auth);

		if (!user_id) {
			throw new UnauthorizedError();
		}

		const user = await this.userService.findByIdWithPassword(user_id);

		/*
		 * A social sign-in account has no password to confirm with. The request is already
		 * authenticated by a valid auth token, which is the same bar every other `/me`
		 * endpoint clears - refusing here would leave such a user unable to delete their
		 * own account at all.
		 */
		if (user.password) {
			const isValidPassword: boolean =
				!!data.password_current &&
				(await this.accountService.checkPassword(
					data.password_current,
					user.password,
				));

			if (!isValidPassword) {
				res.locals.output.errors([
					{
						password_current: lang(
							'account.validation.invalid_password',
						),
					},
				]);

				throw new BadRequestError();
			}
		}

		await this.userService.delete(user_id);

		res.locals.output.message(lang('account.success.delete'));

		res.json(res.locals.output);
	});
}

export const accountController = new AccountController(
	accountPolicy,
	new AccountValidator('account'),
	accountService,
	accountTokenService,
	accountOAuthService,
	accountRecoveryService,
	accountEmailService,
	userService,
);
