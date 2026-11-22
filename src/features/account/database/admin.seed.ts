import { v4 as uuid } from 'uuid';
import dataSource from '@/config/data-source.config';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import UserEntity, { UserStatusEnum } from '@/features/user/user.entity';
import { getSystemLogger } from '@/providers/logger.provider';
import { UserRoleEnum } from '@/shared/types/user-role.type';

/**
 * Creates the first administrator, so a freshly migrated database has a way in.
 *
 * Written in the same standalone style as `permission.seed.ts` and `template.seed.ts` -
 * owning its connection lifecycle and runnable directly - rather than as a
 * `SeedDefinition`, because this project has no seed runner to register one with.
 *
 * Credentials come from the environment and have no defaults, deliberately: a fallback
 * would be a published administrator password the moment this runs anywhere real.
 *
 * Run it as:
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… tsx src/features/account/database/admin.seed.ts
 *
 * From a production image, where tsx is not installed:
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node src/features/account/database/admin.seed.js
 */

function readRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(
			`${name} must be set. This seed has no default credentials by design.`,
		);
	}

	return value;
}

async function seedAdmin(): Promise<void> {
	const email = readRequiredEnv('ADMIN_EMAIL');
	const password = readRequiredEnv('ADMIN_PASSWORD');
	const name = process.env.ADMIN_NAME?.trim() || 'Administrator';

	// A password rejected at login is a confusing way to discover the account was created
	// with something the validator would never accept, so it is checked before insert.
	const minimumLength = Configuration.get('user.passwordMinChars');

	if (password.length < minimumLength) {
		throw new Error(
			`ADMIN_PASSWORD must be at least ${minimumLength} characters.`,
		);
	}

	if (!email.includes('@')) {
		throw new Error('ADMIN_EMAIL must be an email address.');
	}

	const connection = dataSource;

	try {
		console.debug('Initializing database connection...');
		await connection.initialize();

		await requestContext.run(
			{
				auth_id: null,
				performed_by: 'admin.seed',
				source: RequestContextSourceEnum.SEED,
				request_id: uuid(),
				language: 'en',
			},
			async () => {
				const repository = connection.getRepository(UserEntity);

				// `withDeleted` matters: a soft-deleted row still occupies the unique index
				// on email, so an insert over one fails rather than being a no-op.
				const existing = await repository.findOne({
					where: { email },
					withDeleted: true,
				});

				if (existing) {
					// Deliberately does not reset the password of an existing
					// administrator - re-running a bootstrap step must never lock
					// someone out.
					getSystemLogger().info(
						`Administrator ${email} already exists - nothing to do`,
					);

					return;
				}

				await repository.save({
					name,
					email,
					/*
					 * Plaintext on purpose: `UserSubscriber.beforeInsert` hashes
					 * `password` on the way in, so a pre-hashed value would be hashed
					 * twice and no login would ever match. The same hook fills
					 * `password_updated_at`, which the recovery flow reads - hence not
					 * setting it here.
					 */
					password,
					// Pre-verified: the address is supplied by whoever runs the deploy,
					// and requiring a confirmation email would make the first login
					// depend on mail delivery working on a brand new environment.
					email_verified_at: new Date(),
					language: Configuration.get('language.default'),
					status: UserStatusEnum.ACTIVE,
					role: UserRoleEnum.ADMIN,
				});

				getSystemLogger().info(`Administrator ${email} created`);
			},
		);
	} catch (error) {
		console.error('Error seeding the administrator:', error);
		throw error;
	} finally {
		if (connection?.isInitialized) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await connection.destroy();
			console.debug('Database connection closed.');
		}
	}
}

(async () => {
	try {
		await seedAdmin();
		process.exit(0);
	} catch (error) {
		console.error('Seeding failed:', error);
		process.exit(1);
	}
})();
