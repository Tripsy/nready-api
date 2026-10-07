import { getSystemLogger } from '@/providers/logger.provider';

/**
 * The slots a feature exposes for other features to plug into, without importing them.
 *
 * A feature that raises a hook declares it in its own `<feature>.hooks.ts` with one of the factories
 * below; a feature that answers it already depends on the raiser, and registers from its
 * `*.bootstrap.ts`. The dependency then runs along an edge the manifest graph already has, and
 * removing the answering feature leaves an empty slot rather than a dangling import.
 *
 * Three shapes, which differ in what a failure does:
 *
 * - **Notification** - runs after the caller's write has committed. A failing handler is logged and
 *   swallowed: the write cannot be taken back by a throw, so propagating would only hand the caller
 *   a 500 for something that already happened.
 * - **Query** - asked before or during a write the caller has not committed. A failure propagates,
 *   since answering the fallback on an error would let the write through on a guess. Also the shape
 *   for a step that must run inside the caller's transaction - it is handed the manager and awaited.
 * - **Keyed provider** - one provider per key (a source type, an entity type), looked up by the
 *   caller, which decides what an absent one means.
 *
 * Every slot holds one handler. Registering twice replaces the first rather than adding a second
 * opinion - there is one owner per step, and a duplicate registration is a reload. `null`
 * unregisters, which is what a test resets to.
 *
 * Bootstraps are skipped in the `test` environment, so every slot is empty there; a test covering
 * a hook registers its own handler.
 */

export type NotificationHandler<TPayload> = (
	payload: TPayload,
) => Promise<void>;

export function createNotification<TPayload>(failureMessage: string) {
	let handler: NotificationHandler<TPayload> | null = null;

	return {
		register: (value: NotificationHandler<TPayload> | null): void => {
			handler = value;
		},

		notify: async (payload: TPayload): Promise<void> => {
			if (!handler) {
				return;
			}

			try {
				await handler(payload);
			} catch (error) {
				// The payload is nested rather than spread: it is generic here, and PINO's typing
				// reads a spread of it as possibly being the message argument
				getSystemLogger().error(
					{ err: error, payload: payload },
					failureMessage,
				);
			}
		},
	};
}

/** `fallback` answers when nothing is registered; a factory, so a mutable answer is never shared. */
export function createQuery<TArgs extends unknown[], TResult>(
	fallback: () => TResult,
) {
	let handler: ((...args: TArgs) => Promise<TResult>) | null = null;

	return {
		register: (
			value: ((...args: TArgs) => Promise<TResult>) | null,
		): void => {
			handler = value;
		},

		ask: (...args: TArgs): Promise<TResult> => {
			if (!handler) {
				return Promise.resolve(fallback());
			}

			return handler(...args);
		},
	};
}

export function createKeyedProvider<TProvider>() {
	const providers = new Map<string, TProvider>();

	return {
		register: (key: string, provider: TProvider | null): void => {
			if (provider) {
				providers.set(key, provider);
			} else {
				providers.delete(key);
			}
		},

		/** The provider for a key, or null when the feature owning it is not installed. */
		get: (key: string): TProvider | null => providers.get(key) ?? null,
	};
}
