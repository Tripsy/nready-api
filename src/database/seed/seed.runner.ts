import { v4 as uuid } from 'uuid';
import dataSource from '@/config/data-source.config';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import {
	runSeeds,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';

/**
 * Fixed so every run of every seed produces the same demo rows. Change it only to
 * regenerate the whole demo dataset from scratch - existing rows are matched by natural
 * key, so a different value inserts a second set alongside the first.
 */
export const RANDOM_SEED = 20260728;

/**
 * Opens the connection, runs `seeds`, closes it. Shared by the orchestrator and by each
 * seed's standalone entry point, so the connection lifecycle is written once.
 */
export async function bootstrapSeeds(
	seeds: readonly SeedDefinition[],
	performedBy: string,
): Promise<SeedSummary[]> {
	const connection = dataSource;

	try {
		console.debug('Initializing database connection...');
		await connection.initialize();

		return await requestContext.run(
			{
				auth_id: null,
				performed_by: performedBy,
				source: RequestContextSourceEnum.SEED,
				request_id: uuid(),
				language: 'en',
			},
			() => runSeeds(connection, seeds, RANDOM_SEED),
		);
	} finally {
		if (connection?.isInitialized) {
			// Subscribers emit history events after the insert resolves; give them a beat
			// to reach their listener before the pool goes away.
			await new Promise((resolve) => setTimeout(resolve, 500));
			await connection.destroy();
			console.debug('Database connection closed.');
		}
	}
}

/** Standalone entry point for a single seed file. */
export async function runSeedFile(seed: SeedDefinition): Promise<void> {
	try {
		await bootstrapSeeds([seed], `${seed.name}.seed`);
		process.exit(0);
	} catch (error) {
		console.error(`Seeding ${seed.name} failed:`, error);
		process.exit(1);
	}
}
