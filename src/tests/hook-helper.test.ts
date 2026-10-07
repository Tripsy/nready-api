import { expect, jest } from '@jest/globals';
import {
	createKeyedProvider,
	createNotification,
	createQuery,
} from '@/helpers/hook.helper';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * The slots features plug into each other through. What differs between the shapes is what a
 * failure does, so that is what this pins: a notification runs after its caller committed and must
 * never hand it a throw, a query gates a write not yet made and must never answer on a guess.
 */
describe('hook.helper', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('createNotification', () => {
		it('does nothing when no handler is registered', async () => {
			const hook = createNotification<{ id: number }>('failed');

			await expect(hook.notify({ id: 1 })).resolves.toBeUndefined();
		});

		it('hands the payload to the registered handler', async () => {
			const hook = createNotification<{ id: number }>('failed');
			const handler = jest
				.fn<(payload: { id: number }) => Promise<void>>()
				.mockResolvedValue();

			hook.register(handler);

			await hook.notify({ id: 1 });

			expect(handler).toHaveBeenCalledWith({ id: 1 });
		});

		// The caller's write has already committed - a throw could only turn it into a 500
		it('logs a failing handler rather than rethrowing', async () => {
			const hook = createNotification<{ id: number }>('failed');
			const error = new Error('boom');
			const logged = jest
				.spyOn(getSystemLogger(), 'error')
				.mockImplementation(() => undefined);

			hook.register(async () => {
				throw error;
			});

			await expect(hook.notify({ id: 1 })).resolves.toBeUndefined();

			expect(logged).toHaveBeenCalledWith(
				{ err: error, payload: { id: 1 } },
				'failed',
			);
		});

		it('stops calling a handler once unregistered', async () => {
			const hook = createNotification<{ id: number }>('failed');
			const handler = jest
				.fn<(payload: { id: number }) => Promise<void>>()
				.mockResolvedValue();

			hook.register(handler);
			hook.register(null);

			await hook.notify({ id: 1 });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('createQuery', () => {
		it('answers the fallback when nothing is registered', async () => {
			const query = createQuery<[id: number], boolean>(() => false);

			await expect(query.ask(1)).resolves.toBe(false);
		});

		it('builds a fresh fallback for every call', async () => {
			const query = createQuery<[], Map<number, number>>(() => new Map());

			const first = await query.ask();

			first.set(1, 1);

			await expect(query.ask()).resolves.toEqual(new Map());
		});

		it('answers with the registered handler, passing its arguments', async () => {
			const query = createQuery<[id: number, name: string], string>(
				() => '',
			);

			query.register(async (id: number, name: string) => `${name}#${id}`);

			await expect(query.ask(3, 'order')).resolves.toBe('order#3');
		});

		// It gates a write not yet made - the fallback on an error would let it through on a guess
		it('propagates a failing handler', async () => {
			const query = createQuery<[id: number], boolean>(() => false);

			query.register(async () => {
				throw new Error('boom');
			});

			await expect(query.ask(1)).rejects.toThrow('boom');
		});
	});

	describe('createKeyedProvider', () => {
		it('answers null for a key nobody registered', () => {
			const providers = createKeyedProvider<{ name: string }>();

			expect(providers.get('shipping')).toBeNull();
		});

		it('keeps one provider per key, the last registration winning', () => {
			const providers = createKeyedProvider<{ name: string }>();

			providers.register('shipping', { name: 'first' });
			providers.register('shipping', { name: 'second' });
			providers.register('subscription', { name: 'other' });

			expect(providers.get('shipping')).toEqual({ name: 'second' });
			expect(providers.get('subscription')).toEqual({ name: 'other' });
		});

		it('forgets a provider registered as null', () => {
			const providers = createKeyedProvider<{ name: string }>();

			providers.register('shipping', { name: 'first' });
			providers.register('shipping', null);

			expect(providers.get('shipping')).toBeNull();
		});
	});
});
