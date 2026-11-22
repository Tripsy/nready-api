import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError, NotFoundError } from '@/exceptions';
import type AccountIdentityEntity from '@/features/account/account-identity.entity';
import type { AccountIdentityProvider } from '@/features/account/account-identity.entity';
import { getAccountIdentityRepository } from '@/features/account/account-identity.repository';
import {
	type OAuthProfile,
	resolveOAuthProfile,
} from '@/features/account/account-oauth.client';
import type UserEntity from '@/features/user/user.entity';
import { UserStatusEnum } from '@/features/user/user.entity';
import { type UserService, userService } from '@/features/user/user.service';
import { createCurrentDate } from '@/helpers/date.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * The provider round-trip, as a function. Injected rather than imported directly so it can
 * be replaced in tests - the alternative is a live HTTP call to Google in the unit suite.
 */
export type ResolveOAuthProfile = (
	provider: AccountIdentityProvider,
	code: string,
	redirect_uri: string,
) => Promise<OAuthProfile>;

export class AccountOAuthService {
	constructor(
		private accountIdentityRepository: ReturnType<
			typeof getAccountIdentityRepository
		>,
		private userService: UserService,
		private resolveProfile: ResolveOAuthProfile,
	) {}

	/**
	 * The provider matches `redirect_uri` against the value used to obtain the code, so it
	 * has to be forwarded verbatim from the client - which means it has to be checked here.
	 *
	 * The provider's own registered-URI list already blocks a redirect to an attacker's
	 * host, so this is defense in depth rather than the primary control; it exists so a
	 * misconfigured provider console cannot turn this endpoint into a code-relay.
	 */
	private assertAllowedRedirectUri(redirect_uri: string): void {
		const frontendUrl = Configuration.get('frontend.url');
		const allowList = Configuration.get('oauth.redirectUriAllowList');

		const isAllowed =
			redirect_uri.startsWith(`${frontendUrl}/`) ||
			redirect_uri === frontendUrl ||
			allowList.some(
				(allowed) =>
					redirect_uri === allowed ||
					redirect_uri.startsWith(`${allowed}/`),
			);

		if (!isAllowed) {
			throw new BadRequestError(
				lang('account.error.invalid_oauth_redirect_uri'),
			);
		}
	}

	/**
	 * @description Rejects users who exist but must not be logged in
	 */
	private assertUserCanLogin(user: UserEntity): void {
		if (user.deleted_at) {
			throw new NotFoundError(lang('account.error.not_found'));
		}

		if (user.status === UserStatusEnum.INACTIVE) {
			throw new NotFoundError(lang('account.error.not_active'));
		}
	}

	private findIdentity(
		provider: AccountIdentityProvider,
		provider_user_id: string,
	): Promise<AccountIdentityEntity | null> {
		return this.accountIdentityRepository
			.createQuery()
			.filterBy('provider', provider)
			.filterBy('provider_user_id', provider_user_id)
			.first();
	}

	/**
	 * @description Attaches a provider identity to an existing user
	 */
	private linkIdentity(
		user_id: EntityId,
		provider: AccountIdentityProvider,
		profile: OAuthProfile,
	): Promise<AccountIdentityEntity> {
		return this.accountIdentityRepository.save({
			user_id: user_id,
			provider: provider,
			provider_user_id: profile.provider_user_id,
			email: profile.email,
			last_login_at: createCurrentDate(),
		});
	}

	/**
	 * @description Creates an account with no password - the provider is the only credential
	 */
	private createUserFromProfile(
		profile: OAuthProfile,
		email: string,
		language: string,
	): Promise<UserEntity> {
		return this.userService.createRegister({
			// Facebook may withhold the name; the local part of the address is the only
			// other thing known about the user, and it is editable afterwards.
			name: profile.name?.trim() || email.split('@')[0],
			email: email,
			// The provider already proved ownership of the address, so the confirmation
			// mail this would otherwise trigger has nothing left to establish.
			email_verified_at: createCurrentDate(),
			status: UserStatusEnum.ACTIVE,
			language: language,
		});
	}

	/**
	 * @description Resolves the user behind an authorization code, creating or linking the
	 * account as needed. Returns a user that is cleared to receive an auth token.
	 */
	public async resolveUser(
		provider: AccountIdentityProvider,
		code: string,
		redirect_uri: string,
		language: string,
	): Promise<UserEntity> {
		this.assertAllowedRedirectUri(redirect_uri);

		const profile = await this.resolveProfile(provider, code, redirect_uri);

		const identity = await this.findIdentity(
			provider,
			profile.provider_user_id,
		);

		// Known identity - the subject id is authoritative, the current email is irrelevant.
		if (identity) {
			const user = await this.userService.findById(
				identity.user_id,
				true,
			);

			this.assertUserCanLogin(user);

			await this.accountIdentityRepository.save({
				id: identity.id,
				email: profile.email,
				last_login_at: createCurrentDate(),
			});

			return user;
		}

		if (!profile.email) {
			throw new BadRequestError(
				lang('account.error.oauth_email_missing'),
			);
		}

		/*
		 * An unverified provider email must never select an existing account: the provider
		 * would be asserting an address its own user never proved, which is a straight
		 * account-takeover path through the social button.
		 */
		if (!profile.email_verified) {
			throw new BadRequestError(
				lang('account.error.oauth_email_unverified'),
			);
		}

		const existing = await this.userService.findByEmail(profile.email);

		if (!existing) {
			const user = await this.createUserFromProfile(
				profile,
				profile.email,
				language,
			);

			await this.linkIdentity(user.id, provider, profile);

			return user;
		}

		this.assertUserCanLogin(existing);

		/*
		 * A pending account is one waiting on the confirmation email. The provider has just
		 * established the same fact that email would have, so completing the registration
		 * here is the correct outcome rather than sending the user back to their inbox.
		 */
		if (existing.status === UserStatusEnum.PENDING) {
			await this.userService.update({
				id: existing.id,
				status: UserStatusEnum.ACTIVE,
				email_verified_at: createCurrentDate(),
			});

			existing.status = UserStatusEnum.ACTIVE;
		} else if (!existing.email_verified_at) {
			await this.userService.update({
				id: existing.id,
				email_verified_at: createCurrentDate(),
			});
		}

		await this.linkIdentity(existing.id, provider, profile);

		return existing;
	}

	/**
	 * @description Lists the providers linked to a user (for the account settings screen)
	 */
	public async findForUser(user_id: EntityId): Promise<
		{
			provider: AccountIdentityProvider;
			email: string | null;
			last_login_at: Date | null;
		}[]
	> {
		const identities = await this.accountIdentityRepository
			.createQuery()
			.select(['id', 'provider', 'email', 'last_login_at'])
			.filterBy('user_id', user_id)
			.all(false);

		return identities.map((identity) => ({
			provider: identity.provider,
			email: identity.email,
			last_login_at: identity.last_login_at,
		}));
	}

	/**
	 * @description Detaches a provider from a user
	 */
	public async unlink(
		user: UserEntity,
		provider: AccountIdentityProvider,
	): Promise<void> {
		const identities = await this.accountIdentityRepository
			.createQuery()
			.select(['id', 'provider'])
			.filterBy('user_id', user.id)
			.all(false);

		const identity = identities.find((i) => i.provider === provider);

		if (!identity) {
			throw new NotFoundError(lang('account.error.oauth_not_linked'));
		}

		// Removing the last credential would lock the user out of their own account.
		if (!user.password && identities.length === 1) {
			throw new CustomError(
				409,
				lang('account.error.oauth_unlink_last_credential'),
			);
		}

		// Hard delete: the table has no `deleted_at` and a soft-deleted row would keep the
		// unique index occupied, blocking the user from ever re-linking that provider.
		await this.accountIdentityRepository
			.createQuery()
			.filterById(identity.id)
			.delete(false);
	}
}

export const accountOAuthService = new AccountOAuthService(
	getAccountIdentityRepository(),
	userService,
	resolveOAuthProfile,
);
