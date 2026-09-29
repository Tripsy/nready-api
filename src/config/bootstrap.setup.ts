import { runFeatureModules } from '@/config/feature-modules.setup';

/**
 * Runs every `*.bootstrap.{ts|js}` - the hook a feature uses to make itself known at startup.
 *
 * What belongs here is registration into a shared registry: something another feature will look
 * up by name without importing the feature that owns it. `article.bootstrap.ts` is the reference
 * - it registers what an article accepts from its readers with
 * `target-participation.registry.ts`, so `comment`, `rating` and `complaint` can refuse a write
 * against a closed article while still knowing nothing about articles.
 *
 * Not for event handlers (`*.listener.ts` owns those), and not for work: this runs before the
 * server listens, so a slow bootstrap is startup latency for every deployment. Registering is
 * synchronous in practice; the default export may still be async, and is awaited.
 *
 * Feature-level only - there is no shared folder counterpart, since shared code needs no
 * discovery to reach the registry it defines.
 */
export async function setupFeatureBootstrap(): Promise<void> {
	return runFeatureModules({
		fileSuffix: 'bootstrap',
		label: 'Feature bootstrap',
	});
}
