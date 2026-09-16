import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import PlaceEntity, { PlaceTypeEnum } from '@/features/place/place.entity';
import PlaceContentEntity from '@/features/place/place-content.entity';

/**
 * Real geography rather than generated strings: places are referenced by every address in
 * the app, so readable names make the rest of the demo data legible. `code` is the natural
 * key - the entity keeps no name column, names live in `place_content`.
 */
type PlaceSeedRow = {
	code: string;
	name: string;
	place_type: (typeof PlaceTypeEnum)[keyof typeof PlaceTypeEnum];
	parent_code: string | null;
	/**
	 * ISO 3166-1 alpha-2, on countries only - the vocabulary country rules are matched against.
	 * Omitted by every region and city, which have no country code of their own.
	 */
	alpha2?: string;
};

const TYPE_LABELS: Record<string, string> = {
	[PlaceTypeEnum.COUNTRY]: 'Country',
	[PlaceTypeEnum.REGION]: 'Region',
	[PlaceTypeEnum.CITY]: 'City',
};

const placeData: readonly PlaceSeedRow[] = [
	// Countries
	{
		code: 'ROU',
		name: 'Romania',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'RO',
	},
	{
		code: 'HUN',
		name: 'Hungary',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'HU',
	},
	{
		code: 'BGR',
		name: 'Bulgaria',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'BG',
	},
	{
		code: 'AUT',
		name: 'Austria',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'AT',
	},
	{
		code: 'DEU',
		name: 'Germany',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'DE',
	},
	{
		code: 'ITA',
		name: 'Italy',
		place_type: PlaceTypeEnum.COUNTRY,
		parent_code: null,
		alpha2: 'IT',
	},

	// Romanian counties
	{
		code: 'RB',
		name: 'Bucuresti',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RCJ',
		name: 'Cluj',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RTM',
		name: 'Timis',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RBV',
		name: 'Brasov',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RCT',
		name: 'Constanta',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RIS',
		name: 'Iasi',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RAR',
		name: 'Arad',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},
	{
		code: 'RSB',
		name: 'Sibiu',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ROU',
	},

	// Foreign regions
	{
		code: 'HPE',
		name: 'Pest',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'HUN',
	},
	{
		code: 'BSO',
		name: 'Sofia',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'BGR',
	},
	{
		code: 'AWI',
		name: 'Wien',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'AUT',
	},
	{
		code: 'DBY',
		name: 'Bayern',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'DEU',
	},
	{
		code: 'DNW',
		name: 'Nordrhein-Westfalen',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'DEU',
	},
	{
		code: 'ILO',
		name: 'Lombardia',
		place_type: PlaceTypeEnum.REGION,
		parent_code: 'ITA',
	},

	// Cities
	{
		code: 'BUC',
		name: 'Bucuresti',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RB',
	},
	{
		code: 'CLJ',
		name: 'Cluj-Napoca',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RCJ',
	},
	{
		code: 'TMS',
		name: 'Timisoara',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RTM',
	},
	{
		code: 'BSV',
		name: 'Brasov',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RBV',
	},
	{
		code: 'CTA',
		name: 'Constanta',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RCT',
	},
	{
		code: 'IAS',
		name: 'Iasi',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RIS',
	},
	{
		code: 'ARD',
		name: 'Arad',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RAR',
	},
	{
		code: 'SBU',
		name: 'Sibiu',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'RSB',
	},
	{
		code: 'BUD',
		name: 'Budapest',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'HPE',
	},
	{
		code: 'SOF',
		name: 'Sofia',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'BSO',
	},
	{
		code: 'VIE',
		name: 'Wien',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'AWI',
	},
	{
		code: 'MUC',
		name: 'Muenchen',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'DBY',
	},
	{
		code: 'DUS',
		name: 'Duesseldorf',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'DNW',
	},
	{
		code: 'MIL',
		name: 'Milano',
		place_type: PlaceTypeEnum.CITY,
		parent_code: 'ILO',
	},
];

/** Cities are what `address.city_id` points at; exported so the address seed agrees. */
export const CITY_CODES: readonly string[] = placeData
	.filter((place) => place.place_type === PlaceTypeEnum.CITY)
	.map((place) => place.code);

export const placeSeed: SeedDefinition = {
	name: 'place',
	run: async ({ manager }): Promise<SeedSummary> => {
		const placeRepository = manager.getRepository(PlaceEntity);
		const contentRepository = manager.getRepository(PlaceContentEntity);

		const existingPlaces = await placeRepository.find({
			select: { id: true, code: true },
			withDeleted: true,
		});

		// Code → id for every place already stored, extended as this run inserts more.
		const idByCode = new Map<string, number>(
			existingPlaces
				.filter((place) => place.code)
				.map((place) => [place.code as string, place.id]),
		);

		let inserted = 0;

		// Sequential rather than batched: a region needs its country's generated id, and a
		// city needs its region's, so each row must be persisted before its children build.
		for (const place of placeData) {
			if (idByCode.has(place.code)) {
				continue;
			}

			const parentId = place.parent_code
				? idByCode.get(place.parent_code)
				: undefined;

			if (place.parent_code && !parentId) {
				throw new Error(
					`Place "${place.code}" references unknown parent "${place.parent_code}"`,
				);
			}

			const saved = await placeRepository.save(
				placeRepository.create({
					code: place.code,
					alpha2_code: place.alpha2 ?? null,
					place_type: place.place_type,
					parent_id: parentId,
				}),
			);

			idByCode.set(place.code, saved.id);
			inserted++;
		}

		// Names live in the content table, one row per language.
		const existingContent = await contentRepository.find({
			select: { place_id: true, language: true },
			withDeleted: true,
		});

		const contentKeys = new Set(
			existingContent.map((content) => `${content.place_id}:en`),
		);

		const pendingContent = placeData
			.filter((place) => {
				const placeId = idByCode.get(place.code);

				return placeId && !contentKeys.has(`${placeId}:en`);
			})
			.map((place) =>
				contentRepository.create({
					place_id: idByCode.get(place.code) as number,
					language: 'en',
					name: place.name,
					type_label: TYPE_LABELS[place.place_type],
					details: null,
				}),
			);

		if (pendingContent.length > 0) {
			await contentRepository.save(pendingContent, { chunk: 50 });
		}

		return {
			entity: 'place',
			alreadyPresent: placeData.length - inserted,
			inserted,
			target: placeData.length,
			// Counted rather than derived from `idByCode`: a place may carry no code, and
			// those rows are absent from that map.
			tableTotal: await placeRepository.count({ withDeleted: true }),
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(placeSeed);
}
