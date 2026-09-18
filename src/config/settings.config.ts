import 'dotenv/config';
import { hostname } from 'node:os';
import { getObjectValue, type ObjectValue } from '@/helpers/objects.helper';
import type { LogDataLevel } from '@/shared/types/log-data.type';
import type { LogHistoryDestination } from '@/shared/types/log-history.type';

/**
 * Deliberately un-annotated so TypeScript infers the literal shape of the returned object.
 * That inferred shape is what gives `Configuration.get()` its key union and return types -
 * annotating this `: Settings` would widen everything to `ObjectValue` and lose both.
 */
function loadSettings() {
	// Read directly from `process.env` rather than through `Configuration`: these decide
	// values inside the settings object being built, so it does not exist yet.
	const environment = process.env.APP_ENV || 'development';
	const isProduction = environment === 'production';
	const isVerbose =
		process.env.APP_DEBUG === 'true' || environment === 'test';

	return {
		app: {
			environment: process.env.APP_ENV || 'development',
			debug: process.env.APP_DEBUG === 'true',
			url: process.env.APP_URL || 'http://nready-api.test',
			port: parseInt(process.env.APP_PORT || '3000', 10),
			port_while_testing: parseInt(
				process.env.APP_PORT_WHILE_TESTING || '3001',
				10,
			),
			name: process.env.APP_NAME || 'nready-api',
			email: process.env.APP_EMAIL || 'hello@example.com',
			timezone: process.env.APP_TIMEZONE || 'UTC',
			currency: process.env.APP_CURRENCY || 'RON',
		},
		language: {
			default: process.env.APP_LANGUAGE_DEFAULT || 'ro',
			supported: (process.env.APP_LANGUAGE_SUPPORTED || 'ro,en')
				.trim()
				.split(','),
		},
		folder: {
			features: '/features',
			shared: '/shared',
		},
		frontend: {
			url: process.env.FRONTEND_URL || 'http://nready-ui.test',
			name: process.env.FRONTEND_APP_NAME || 'nready-ui',
		},
		apiDocs: {
			/*
			 * Whether `/public/api-docs` answers at all. Opt-in, like every other boolean
			 * here: an environment that has not said `true` publishes nothing, so a
			 * deployment that never heard of this setting does not start handing out the
			 * shape of its bearer-gated endpoints.
			 */
			enabled: process.env.API_DOCS_ENABLED === 'true',
		},
		security: {
			allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map((v) =>
				v.trim(),
			) || ['http://localhost'],
			/*
			 * Keys the HMAC behind `hashClientIp` - the form every `user_ip_hash` column
			 * stores an address in. A separate secret from `user.authSecret` because the two
			 * rotate on different schedules and the consequences differ: rotating this one
			 * makes every stored hash stop matching the caller it belongs to, so anything
			 * rationed per address (one rating per target, guest comment throttling) starts
			 * counting again from zero.
			 */
			ipHashSecret: process.env.IP_HASH_SECRET || 'secret',
			/*
			 * Keys accepted in the `x-api-key` header of every request (`/health` and
			 * `/ready` excepted). A list rather than one value so a key can be rotated
			 * without a synchronized deploy: publish `old,new`, move the clients over,
			 * then drop `old` in a second release.
			 *
			 * Empty disables the gate entirely, which is what a `test` run and a fresh
			 * checkout get. `clientKeyMiddleware` warns at boot when that happens in
			 * production, since there the empty list means the API answers anyone.
			 */
			clientKeys: (process.env.CLIENT_API_KEYS || '')
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean),
		},
		redis: {
			host: process.env.REDIS_HOST || 'localhost',
			port: parseInt(process.env.REDIS_PORT || '6379', 10),
			password: process.env.REDIS_PASSWORD || '',
			/*
			 * This app and the frontend client share one Redis instance and database, so
			 * every key is namespaced by app. Applied in `CacheProvider.buildKey` rather than
			 * through ioredis's own `keyPrefix` option: that one does not reach the MATCH
			 * argument of SCAN, so `deleteByPattern` would scan the *other* app's keys and
			 * then delete against them - leaving the collision risk in place while appearing
			 * to solve it.
			 */
			keyPrefix: process.env.REDIS_KEY_PREFIX || 'nready-api',
		},
		cache: {
			ttl:
				process.env.CACHE_TTL &&
				Number.isFinite(Number(process.env.CACHE_TTL))
					? Number(process.env.CACHE_TTL)
					: 60,
		},
		/*
		 * Each `level*` array is the set of levels one destination accepts; an empty array
		 * means that destination is not built at all (see `log-destinations.factory.ts`).
		 */
		logging: {
			logLevel: process.env.PINO_LOG_LEVEL || ('trace' as LogDataLevel),
			levelConsole: (isVerbose
				? ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
				: []) as LogDataLevel[],
			// Production hosts are ephemeral, so rotating files on disk buy nothing and
			// are lost with the instance - CloudWatch replaces them there.
			levelFile: (isProduction
				? []
				: [
						'debug',
						'info',
						'error',
						'warn',
						'fatal',
					]) as LogDataLevel[],
			/*
			 * Only what is worth keeping in the application's own database. `info` and
			 * `warn` are the bulk of the volume and belong in CloudWatch instead, which is
			 * cheaper per byte and holds the longer tail - `log_data` sits on the instance's
			 * disk, and `clean-log-data.cron.ts` keeps only the last 30 days of it.
			 *
			 * `error` and `fatal` stay here on purpose: this table is queryable from the
			 * app itself and from local tooling, which is a materially faster path to
			 * "why did that fail" than the CloudWatch console.
			 */
			levelDatabase: ['error', 'fatal'] as LogDataLevel[],
			// Only `fatal` by default: this channel mails on every match, and error-level
			// volume would make it noise. Widen it here for a deployment that wants more.
			levelEmail: ['fatal'] as LogDataLevel[],
			// Not gated on environment - the destination is skipped unless a log group is
			// configured, so setting AWS_CLOUDWATCH_LOG_GROUP is enough to try it in dev.
			levelCloudWatch: [
				'info',
				'warn',
				'error',
				'fatal',
			] as LogDataLevel[],
			logEmail: process.env.PINO_LOG_EMAIL || '',
			history: process.env.LOGGING_HISTORY as LogHistoryDestination,
		},
		aws: {
			region: process.env.AWS_REGION || '',
			ses: {
				/*
				 * SES identities are verified per region, so the region that can send mail
				 * is not necessarily the one the application runs in - a domain verified
				 * years ago in one region stays there, while the instance lives wherever it
				 * was deployed. Falling back to AWS_REGION keeps the common single-region
				 * case configuration-free.
				 */
				region:
					process.env.AWS_SES_REGION || process.env.AWS_REGION || '',
			},
			cloudwatch: {
				logGroup: process.env.AWS_CLOUDWATCH_LOG_GROUP || '',
				// One stream per host keeps concurrent writers off a shared stream.
				logStream: process.env.AWS_CLOUDWATCH_LOG_STREAM || hostname(),
			},
		},
		mail: {
			provider: process.env.MAIL_PROVIDER || 'smtp', // 'smtp' or 'ses'
			from: {
				name: process.env.MAIL_FROM_NAME || 'NReady',
				address: process.env.MAIL_FROM_ADDRESS || 'engine@play-zone.ro',
			},
			host: process.env.MAIL_HOST,
			port: parseInt(process.env.MAIL_PORT || '2525', 10),
			encryption: process.env.MAIL_ENCRYPTION === 'true',
			username: process.env.MAIL_USERNAME || '',
			password: process.env.MAIL_PASSWORD || '',
		},
		filter: {
			limit: 20,
			termMinLength: 3,
		},
		/*
		 * The percentage each `ProductVatCategoryEnum` class resolves to. The product declares a
		 * class, not a rate, because the rate is a function of jurisdiction and date - so it is
		 * resolved when a line is priced and snapshot onto `order_line.vat_rate` at
		 * confirmation, and a later rate change cannot move an invoice already issued.
		 *
		 * Defaults are the Romanian rates. A deployment in another jurisdiction overrides them
		 * through the environment; nothing here is derived from the currency, which says where the
		 * money is quoted rather than which tax authority applies.
		 */
		vat: {
			standard: Number(process.env.VAT_RATE_STANDARD ?? 21),
			reduced: Number(process.env.VAT_RATE_REDUCED ?? 11),
			second_reduced: Number(process.env.VAT_RATE_SECOND_REDUCED ?? 5),
			zero: 0,
			exempt: 0,
		},
		/*
		 * What moving goods costs, by the kind of movement. Every figure is in the base currency
		 * (`app.currency`); a quote in another currency is converted at the order's exchange rate.
		 *
		 * `price` is what the client pays for a courier delivery or a return, **VAT included** -
		 * the figure a shopper is shown - and is split back into a net price at the standard VAT
		 * rate when a shipment is written. A relocation is internal and a self-pickup carries
		 * nothing, so neither is charged. Domestic means the client address resolves to
		 * `domesticCountry` (ISO 3166-1 alpha-2, the vocabulary `place.alpha2_code` holds).
		 *
		 * `operationalCost` is the business's own estimate of carrying one out, written onto the
		 * shipment as its starting `operational_cost` and replaced once the carrier invoices.
		 */
		shipping: {
			domesticCountry: (
				process.env.SHIPPING_DOMESTIC_COUNTRY || 'RO'
			).toUpperCase(),
			price: {
				domestic: Number(process.env.SHIPPING_PRICE_DOMESTIC ?? 25),
				international: Number(
					process.env.SHIPPING_PRICE_INTERNATIONAL ?? 50,
				),
			},
			operationalCost: {
				delivery: Number(
					process.env.SHIPPING_OPERATIONAL_COST_DELIVERY ?? 15,
				),
				return: Number(
					process.env.SHIPPING_OPERATIONAL_COST_RETURN ?? 15,
				),
				relocation: Number(
					process.env.SHIPPING_OPERATIONAL_COST_RELOCATION ?? 30,
				),
			},
		},
		user: {
			authSecret: (process.env.AUTH_JWT_SECRET as string) || 'secret',
			authExpiresIn: Number(process.env.AUTH_JWT_EXPIRES_IN) || 86400,
			authRefreshExpiresIn:
				Number(process.env.AUTH_JWT_REFRESH_EXPIRES_IN) || 28800,
			emailConfirmationSecret:
				(process.env.EMAIL_JWT_SECRET as string) || 'secret',
			emailConfirmationExpiresIn:
				Number(process.env.EMAIL_JWT_EXPIRES_IN) || 30,
			maxActiveSessions: 2,
			recoveryIdentExpiresIn: 7200,
			recoveryAttemptsInLastSixHours: 3,
			recoveryEnableMetadataCheck: true,
			nameMinChars: 3,
			passwordMinChars: 8,
			loginMaxFailedAttemptsForIp: 5,
			loginMaxFailedAttemptsForEmail: 3,
			loginFailedAttemptsLockTime: 900,
		},
		/*
		 * Social sign-in. The frontend runs the browser half of the authorization-code
		 * flow and posts the resulting `code` here; the secrets below never leave the
		 * backend, which is the whole point of not doing the exchange in the browser.
		 *
		 * A provider with an empty `clientId` is treated as not configured and its
		 * endpoint answers 501 - so a deployment can enable Google without Facebook.
		 */
		oauth: {
			/*
			 * `redirect_uri` has to be sent on the exchange because the provider matches it
			 * against the one used to obtain the code. It arrives from the client, so it is
			 * checked here rather than trusted: anything under `frontend.url` is accepted,
			 * and this list covers the extra origins (preview deployments, a second
			 * frontend) that a single backend may serve.
			 */
			redirectUriAllowList: (
				process.env.OAUTH_REDIRECT_URI_ALLOW_LIST || ''
			)
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean),
			google: {
				clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || '',
				clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || '',
			},
			facebook: {
				clientId: process.env.OAUTH_FACEBOOK_CLIENT_ID || '',
				clientSecret: process.env.OAUTH_FACEBOOK_CLIENT_SECRET || '',
				// Graph API is versioned and versions are retired on a schedule, so this is
				// configurable rather than pinned in code.
				apiVersion: process.env.OAUTH_FACEBOOK_API_VERSION || 'v21.0',
			},
		},
	};
}

type Settings = ReturnType<typeof loadSettings>;

/**
 * Every valid dotted path into `Settings`, as a union of string literals.
 *
 * Arrays stop the recursion - `logging.levelFile` is a leaf, there is no
 * `logging.levelFile.0`. `NonNullable` lets an optional branch (`mail.host` is
 * `string | undefined`) still be classified by its non-undefined type.
 */
export type SettingsKey<T = Settings> = {
	[K in keyof T & string]: T[K] extends readonly unknown[]
		? K
		: NonNullable<T[K]> extends object
			? K | `${K}.${SettingsKey<NonNullable<T[K]>>}`
			: K;
}[keyof T & string];

/** The type stored at a given dotted path. */
export type SettingsValue<
	K extends string,
	T = Settings,
> = K extends `${infer Head}.${infer Rest}`
	? Head extends keyof T
		? SettingsValue<Rest, NonNullable<T[Head]>>
		: never
	: K extends keyof T
		? T[K]
		: never;

/**
 * Settings are derived once, on first read, and reused.
 *
 * `loadSettings()` is not cheap - it re-reads ~40 environment variables, runs `parseInt` and
 * `split` over them and calls `hostname()` - and `Configuration.get()` is called ~1000 times
 * during boot alone. Nothing here can change after the process starts (`dotenv/config` is
 * imported at the top of this module, before any reader), so a per-read rebuild would buy
 * nothing.
 *
 * The single instance is also what lets `set()` work at all: a writer has to mutate the
 * object every reader sees, not a throwaway rebuilt on the spot.
 */
let settings: Settings | undefined;

function getSettings(): Settings {
	settings ??= loadSettings();

	return settings;
}

export const Configuration = {
	/**
	 * Reads a setting by dotted path. The path is checked against the shape of
	 * `loadSettings()`, so a typo is a compile error rather than an `undefined` at runtime,
	 * and the return type is inferred - no `as string` needed at the call site.
	 */
	get: <K extends SettingsKey>(key: K): SettingsValue<K> => {
		const value = getObjectValue(
			getSettings() as Record<string, ObjectValue>,
			key,
		);

		if (value === undefined) {
			// Unreachable for a well-typed key unless the value is genuinely optional
			// (eg: `mail.host`); kept as a guard for dynamic paths.
			console.warn(`Configuration key not found: ${key}`);
		}

		return value as SettingsValue<K>;
	},

	// Currently unused
	// set: <K extends SettingsKey>(key: K, value: SettingsValue<K>): void => {
	// 	const success = setObjectValue(
	// 		getSettings() as Record<string, ObjectValue>,
	// 		key,
	// 		value as ObjectValue,
	// 	);
	//
	// 	if (!success) {
	// 		console.warn(`Failed to set configuration key: ${key}`);
	// 	}
	// },

	// These read the cached object directly rather than going through `get()`. They are
	// the hottest paths - every `lang()` call hits `isEnvironment` - and this skips the
	// dotted-path split, the lookup and the undefined check for a plain property read.
	environment: () => {
		return getSettings().app.environment;
	},

	isEnvironment: (value: string) => {
		return getSettings().app.environment === value;
	},

	language: () => {
		return getSettings().language.default;
	},

	isSupportedLanguage: (language: string): boolean => {
		return getSettings().language.supported.includes(language);
	},

	currency: () => {
		return getSettings().app.currency;
	},

	resolveExtension: () => {
		return Configuration.environment() === 'production' ? 'js' : 'ts';
	},

	/**
	 * Drops the cache so the next read re-derives from `process.env`.
	 * Only for tests that need to exercise a different environment.
	 */
	reset: (): void => {
		settings = undefined;
	},
};
