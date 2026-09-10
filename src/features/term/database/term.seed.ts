import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import TermEntity, {
	type TermType,
	TermTypeEnum,
} from '@/features/term/term.entity';
import { CASE_PRESERVING_TYPES } from '@/features/term/term.service';
import TermContentEntity from '@/features/term/term-content.entity';

type TermRow = {
	type: TermType;
	/** The English wording, and the key this seed re-runs against. */
	en: string;
	/** Omitted where no translation exists yet - the reader falls back to `en`. */
	ro?: string;
};

/**
 * The vocabulary is fixed rather than generated: a taxonomy only reads as real if the terms
 * mean something, and `attribute_label` / `attribute_value` have to pair up for
 * `product_attribute` to be seeded on top of them later.
 *
 * One entry is one term across every language, which is the whole point of the shape - a
 * product pointing at "Color" renders as "Culoare" in Romanian rather than pinning itself to
 * whichever row was picked at write time.
 *
 * `type` + `en` is the key this seed matches on, so no two entries may share that pair.
 */
const TERMS: readonly TermRow[] = [
	// Tags
	{ type: TermTypeEnum.TAG, en: 'Summer', ro: 'Vara' },
	{ type: TermTypeEnum.TAG, en: 'Winter', ro: 'Iarna' },
	{ type: TermTypeEnum.TAG, en: 'New Arrival', ro: 'Noutati' },
	{ type: TermTypeEnum.TAG, en: 'Best Seller', ro: 'Cel mai vandut' },
	{ type: TermTypeEnum.TAG, en: 'Clearance', ro: 'Lichidare' },
	{ type: TermTypeEnum.TAG, en: 'Limited Edition', ro: 'Editie limitata' },
	{ type: TermTypeEnum.TAG, en: 'Eco Friendly', ro: 'Ecologic' },
	{ type: TermTypeEnum.TAG, en: 'Vegetarian', ro: 'Vegetarian' },
	{ type: TermTypeEnum.TAG, en: 'Spicy', ro: 'Picant' },

	// Attribute labels
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Color', ro: 'Culoare' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Size', ro: 'Marime' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Material', ro: 'Material' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Capacity', ro: 'Capacitate' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Storage', ro: 'Stocare' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Diameter', ro: 'Diametru' },
	{ type: TermTypeEnum.ATTRIBUTE_LABEL, en: 'Volume', ro: 'Volum' },
	{
		type: TermTypeEnum.ATTRIBUTE_LABEL,
		en: 'Spice level',
		ro: 'Nivel de iuteala',
	},

	// Attribute values - colors
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Red', ro: 'Rosu' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Blue', ro: 'Albastru' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Green', ro: 'Verde' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Black', ro: 'Negru' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Silver', ro: 'Argintiu' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'White', ro: 'Alb' },

	// Attribute values - sizes and materials
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Small', ro: 'Mic' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Medium', ro: 'Mediu' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Large', ro: 'Mare' },
	/*
	 * Garment sizes stand beside the generic small / medium / large: an apparel category asks
	 * the same *Size* label, but the value it admits is the letter printed on the label.
	 */
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'S' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'M' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'L' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'XL' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Cotton', ro: 'Bumbac' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Leather', ro: 'Piele' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: '500 ml' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: '1 litre', ro: '1 litru' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Aluminium', ro: 'Aluminiu' },

	// Attribute values - storage sizes and how hot a dish is
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: '256 GB' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: '512 GB' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: '1 TB' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Mild', ro: 'Bland' },
	{ type: TermTypeEnum.ATTRIBUTE_VALUE, en: 'Hot', ro: 'Iute' },

	// Free text
	{ type: TermTypeEnum.TEXT, en: 'Free shipping', ro: 'Transport gratuit' },
	{
		type: TermTypeEnum.TEXT,
		en: 'Returns within 30 days',
		ro: 'Retur in 30 de zile',
	},

	/*
	 * Free text is also what an order-time option is made of - both the question a
	 * `product_option_group` asks and the answers under it, which is the type the dashboard's
	 * option picker searches. Deliberately not `attribute_label` / `attribute_value`: those
	 * belong to the category attribute vocabulary, where a definition governs the wording.
	 */
	{ type: TermTypeEnum.TEXT, en: 'Choose your crust', ro: 'Alege blatul' },
	{ type: TermTypeEnum.TEXT, en: 'Thin crust', ro: 'Blat subtire' },
	{ type: TermTypeEnum.TEXT, en: 'Classic crust', ro: 'Blat clasic' },
	{ type: TermTypeEnum.TEXT, en: 'Sourdough crust', ro: 'Blat cu maia' },
	{ type: TermTypeEnum.TEXT, en: 'Extra toppings', ro: 'Ingrediente extra' },
	{ type: TermTypeEnum.TEXT, en: 'Extra cheese', ro: 'Cascaval extra' },
	{ type: TermTypeEnum.TEXT, en: 'Pepperoni', ro: 'Salam picant' },
	{ type: TermTypeEnum.TEXT, en: 'Mushrooms', ro: 'Ciuperci' },
	{ type: TermTypeEnum.TEXT, en: 'Olives', ro: 'Masline' },
	{ type: TermTypeEnum.TEXT, en: 'Finishing touches', ro: 'Optiuni finale' },
	{ type: TermTypeEnum.TEXT, en: 'Gift wrap', ro: 'Ambalaj cadou' },
	{
		type: TermTypeEnum.TEXT,
		en: 'Custom back print',
		ro: 'Imprimeu personalizat pe spate',
	},
	{
		type: TermTypeEnum.TEXT,
		en: 'Extended warranty',
		ro: 'Garantie extinsa',
	},
	{ type: TermTypeEnum.TEXT, en: 'One extra year', ro: 'Inca un an' },
	{ type: TermTypeEnum.TEXT, en: 'Two extra years', ro: 'Inca doi ani' },

	// Bundle choice prompts - the question a `product_bundle_group` asks
	{
		type: TermTypeEnum.BUNDLE_CHOICE,
		en: 'Choose your fries',
		ro: 'Alege cartofii',
	},
	{
		type: TermTypeEnum.BUNDLE_CHOICE,
		en: 'Choose your drink',
		ro: 'Alege bautura',
	},
	{
		type: TermTypeEnum.BUNDLE_CHOICE,
		en: 'Choose your pizza',
		ro: 'Alege pizza',
	},
	{
		type: TermTypeEnum.BUNDLE_CHOICE,
		en: 'Choose your sauce',
		ro: 'Alege sosul',
	},
];

/**
 * The key a re-run matches on. Always folded, whatever the type is stored as: it only has to line
 * a literal up with the row already written, and `TermService.assertNotDuplicate` compares the
 * same way. Without it a raw literal would miss every existing term and the whole set would be
 * inserted again.
 */
const termMatchKey = (value: string): string => value.trim().toLowerCase();

/**
 * The wording actually written, which follows `TermService.normalizeContents`. The seed writes
 * rows directly, so it has to apply that rule itself - through the service's own list, since a
 * second copy of it here is what let the two drift.
 */
const storedTermValue = (type: TermType, value: string): string =>
	CASE_PRESERVING_TYPES.includes(type)
		? value.trim()
		: value.trim().toLowerCase();

export const termSeed: SeedDefinition = {
	name: 'term',
	run: async ({ manager }): Promise<SeedSummary> => {
		const termRepository = manager.getRepository(TermEntity);
		const contentRepository = manager.getRepository(TermContentEntity);

		/*
		 * Every language, not only English: the key a re-run matches on is the English wording,
		 * but the restatement below writes back rows in whatever language they are stored in,
		 * and `id` has to come with them or `save` would insert instead of update.
		 */
		const existingContents = await contentRepository.find({
			select: {
				id: true,
				term_id: true,
				language: true,
				value: true,
			},
			withDeleted: true,
			relations: { term: true },
		});

		const idByKey = new Map<string, number>(
			existingContents
				.filter((content) => content.term && content.language === 'en')
				.map((content) => [
					`${content.term.type}:${termMatchKey(content.value)}`,
					content.term_id,
				]),
		);

		const pending = TERMS.filter(
			(row) => !idByKey.has(`${row.type}:${termMatchKey(row.en)}`),
		);

		/*
		 * A term whose type stopped being folded still holds the wording written under the old
		 * rule, and a top-up would never touch it: the key matches case-insensitively, so the
		 * row counts as present and the storefront keeps rendering "choose your crust". Only the
		 * rows this file states the wording for are rewritten - a term typed in the dashboard
		 * carries a casing nobody here knows.
		 */
		const restated: TermContentEntity[] = [];

		for (const row of TERMS) {
			if (!CASE_PRESERVING_TYPES.includes(row.type)) {
				continue;
			}

			const term_id = idByKey.get(`${row.type}:${termMatchKey(row.en)}`);

			if (!term_id) {
				continue;
			}

			for (const [language, wording] of [
				['en', row.en],
				['ro', row.ro],
			] as const) {
				if (!wording) {
					continue;
				}

				const stored = existingContents.find(
					(content) =>
						content.term_id === term_id &&
						content.language === language,
				);

				if (!stored || stored.value === wording.trim()) {
					continue;
				}

				stored.value = wording.trim();
				restated.push(stored);
			}
		}

		if (restated.length > 0) {
			await contentRepository.save(restated);
		}

		for (const row of pending) {
			const term = await termRepository.save(
				termRepository.create({ type: row.type }),
			);

			const contents = [
				contentRepository.create({
					term_id: term.id,
					language: 'en',
					value: storedTermValue(row.type, row.en),
				}),
			];

			if (row.ro) {
				contents.push(
					contentRepository.create({
						term_id: term.id,
						language: 'ro',
						value: storedTermValue(row.type, row.ro),
					}),
				);
			}

			await contentRepository.save(contents);

			idByKey.set(`${row.type}:${termMatchKey(row.en)}`, term.id);
		}

		return {
			entity: 'term',
			alreadyPresent: TERMS.length - pending.length,
			inserted: pending.length,
			target: TERMS.length,
			tableTotal: idByKey.size,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(termSeed);
}
