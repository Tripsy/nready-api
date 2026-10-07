import { pathToFileURL } from 'node:url';
import type { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

/**
 * Deterministic PRNG (mulberry32). Demo data has to be reproducible: two developers
 * running the seeds get the same rows, and a re-run tops up with the *same* values it
 * would have inserted the first time. `Math.random` cannot give either.
 */
export function createRandom(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;

		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type Random = ReturnType<typeof createRandom>;

/** Integer in `[min, max]`, both ends inclusive. */
export function randomInt(random: Random, min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1));
}

export function randomPick<T>(random: Random, values: readonly T[]): T {
	return values[randomInt(random, 0, values.length - 1)];
}

/** A moment between `daysBack` days ago and now, to spread rows across a date filter. */
export function randomPastDate(random: Random, daysBack: number): Date {
	const millisecondsBack = randomInt(random, 0, daysBack * 86400) * 1000;

	return new Date(Date.now() - millisecondsBack);
}

/**
 * A Romanian IBAN that passes the ISO 13616 check `validateIBAN` applies: `RO`, two check digits,
 * a four-letter bank code, then a sixteen-character account. The check digits are computed, not
 * drawn, so a seeded client can be saved back through the API unchanged.
 */
export function romanianIban(bankCode: string, account: string): string {
	const bban = `${bankCode.toUpperCase()}${account.padStart(16, '0').slice(-16)}`;

	// Mod 97 over the BBAN followed by `RO00`, letters as two-digit numbers (A = 10)
	const numeric = `${bban}RO00`.replace(/[A-Z]/g, (char) =>
		(char.charCodeAt(0) - 55).toString(),
	);

	const remainder = BigInt(numeric) % 97n;
	const checkDigits = (98n - remainder).toString().padStart(2, '0');

	return `RO${checkDigits}${bban}`;
}

/** Zero-padded sequence suffix, so natural keys sort and read predictably. */
export function sequenceLabel(index: number, width = 4): string {
	return String(index + 1).padStart(width, '0');
}

export type SeedSummary = {
	entity: string;
	/** How many of the `target` candidates were already stored before this run. */
	alreadyPresent: number;
	inserted: number;
	target: number;
	/** Total rows in the table afterward, seeded or not. */
	tableTotal: number;
};

type TopUpOptions<Row extends ObjectLiteral> = {
	entity: string;
	target: number;
	manager: EntityManager;
	// biome-ignore lint/suspicious/noExplicitAny: TypeORM's entity target accepts any constructor
	entityClass: new () => any;
	/**
	 * Column holding the row's natural key. Rows whose key is already present are skipped,
	 * which is what makes a re-run insert only the remainder instead of duplicating.
	 */
	keyColumn: keyof Row & string;
	/** Builds candidate row `index` (0-based). Must be a pure function of `index`. */
	buildRow: (index: number) => Row | Promise<Row>;
};

/**
 * Inserts candidates `0..target-1` whose natural key is not in the table yet.
 *
 * Top-up rather than wipe-and-insert: `order`, `invoice`, `product` and friends hold
 * `RESTRICT` foreign keys, so clearing a parent table fails while children reference it -
 * and the database already holds rows worth keeping. Counting alone would not be enough
 * either, since re-running has to avoid colliding with the unique indexes on `slug`,
 * `sku`, `email` and friends; comparing natural keys avoids both.
 */
export async function topUp<Row extends ObjectLiteral>(
	options: TopUpOptions<Row>,
): Promise<SeedSummary> {
	const { entity, target, manager, entityClass, keyColumn, buildRow } =
		options;

	const repository = manager.getRepository(entityClass);

	// `withDeleted` on purpose: a soft-deleted row still occupies its unique key.
	const existingRows = await repository.find({
		select: { [keyColumn]: true },
		withDeleted: true,
	});

	const existingKeys = new Set(
		existingRows.map((row) => String(row[keyColumn])),
	);

	const pending: Row[] = [];
	let alreadyPresent = 0;

	for (let index = 0; index < target; index++) {
		const row = await buildRow(index);

		if (existingKeys.has(String(row[keyColumn]))) {
			alreadyPresent++;
			continue;
		}

		pending.push(row);
	}

	if (pending.length > 0) {
		// Chunked so a large seed does not build one oversized parameterised statement.
		await repository.save(pending, { chunk: 50 });
	}

	return {
		entity,
		alreadyPresent,
		inserted: pending.length,
		target,
		tableTotal: existingKeys.size + pending.length,
	};
}

/** Rows already in the table, used by seeds that need real parent ids to reference. */
export async function loadIds(
	manager: EntityManager,
	// biome-ignore lint/suspicious/noExplicitAny: TypeORM's entity target accepts any constructor
	entityClass: new () => any,
	where: ObjectLiteral = {},
): Promise<number[]> {
	const rows = await manager.getRepository(entityClass).find({
		select: { id: true },
		where,
		order: { id: 'ASC' },
	});

	return rows.map((row) => row.id as number);
}

export function formatSummary(summary: SeedSummary): string {
	const { entity, alreadyPresent, inserted, target, tableTotal } = summary;

	// Rows that were in the table before any seed ran - reported separately so the
	// seeded ratio never reads as more than its target.
	const untouched = tableTotal - alreadyPresent - inserted;
	const untouchedNote = untouched > 0 ? `, ${untouched} pre-existing` : '';

	if (inserted === 0) {
		return `${entity}: ${alreadyPresent}/${target} seeded${untouchedNote}, nothing to do`;
	}

	return `${entity}: inserted ${inserted}, now ${alreadyPresent + inserted}/${target} seeded${untouchedNote} ✅`;
}

/**
 * Guards a seed's standalone entry point. Under the orchestrator the module is imported,
 * not executed, so the self-run block must stay inert.
 */
export function isDirectRun(moduleUrl: string): boolean {
	const entryPoint = process.argv[1];

	if (!entryPoint) {
		return false;
	}

	// Full-URL comparison rather than a basename match, so two seeds sharing a file name
	// under different features cannot both claim to be the entry point.
	return moduleUrl === pathToFileURL(entryPoint).href;
}

export type SeedContext = {
	manager: EntityManager;
	random: Random;
};

export type SeedDefinition = {
	name: string;
	run: (context: SeedContext) => Promise<SeedSummary>;
};

/** Runs `seeds` inside one transaction, under the shared request context. */
export async function runSeeds(
	dataSource: DataSource,
	seeds: readonly SeedDefinition[],
	randomSeed: number,
): Promise<SeedSummary[]> {
	const summaries: SeedSummary[] = [];

	await dataSource.transaction(async (manager) => {
		for (const seed of seeds) {
			// Each seed gets its own generator instance so running one alone produces the
			// same rows it would produce inside a full run.
			const summary = await seed.run({
				manager,
				random: createRandom(randomSeed),
			});

			summaries.push(summary);
			console.info(formatSummary(summary));
		}
	});

	return summaries;
}
