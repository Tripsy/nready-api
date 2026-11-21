import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type { TermType } from '@/features/term/term.entity';
import TermEntity, { TermTypeEnum } from '@/features/term/term.entity';
import { getTermRepository } from '@/features/term/term.repository';
import {
	paramsUpdateList,
	type TermValidator,
} from '@/features/term/term.validator';
import TermContentEntity, {
	type TermContentType,
} from '@/features/term/term-content.entity';
import TermContentRepository from '@/features/term/term-content.repository';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Columns owned by the term row itself.
 */
const entryColumns: string[] = paramsUpdateList.filter(
	(param) => param !== 'contents',
);

/**
 * The types whose wording is stored as it was typed.
 *
 * The line is drawn at what the customer reads. `bundle_choice` and `text` are **sentences**
 * shown on the storefront - the question a bundle asks, the question an order-time option asks
 * and each of its answers - and lower-casing them would put "choose your crust" on the page.
 * `attribute_label` is the heading a specification renders under, so it is written the same way.
 *
 * `tag` and `attribute_value` are folded, because they are picked from a shared vocabulary and
 * "Summer" beside "summer" rendering as two tags is a defect.
 *
 * Folding is about how the value is *stored*; it never decided uniqueness. `assertNotDuplicate`
 * compares `LOWER()` on both sides, so an exempt type still cannot hold two terms differing only
 * in case.
 */
export const CASE_PRESERVING_TYPES: readonly TermType[] = [
	TermTypeEnum.ATTRIBUTE_LABEL,
	TermTypeEnum.TEXT,
	TermTypeEnum.BUNDLE_CHOICE,
];

export class TermService {
	constructor(private repository: ReturnType<typeof getTermRepository>) {}

	/** Applies the folding rule above. Called before the duplicate check and before the write. */
	private normalizeContents(
		type: TermType,
		contents: TermContentType[],
	): TermContentType[] {
		if (CASE_PRESERVING_TYPES.includes(type)) {
			return contents;
		}

		return contents.map((content) => ({
			...content,
			value: content.value.toLowerCase(),
		}));
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<TermValidator, 'create'>,
	): Promise<TermEntity> {
		const contents = this.normalizeContents(data.type, data.contents);

		await this.assertNotDuplicate(data.type, contents);

		return dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(TermEntity);

			const entrySaved = await repository.save({ type: data.type });

			await TermContentRepository.saveContent(
				manager,
				contents,
				entrySaved.id,
			);

			/*
			 * The translations are written through a query builder, so the saved term carries
			 * none of them back on its own. A term has no wording outside `contents` - a
			 * response without them names nothing, and a caller that links the new term
			 * straight away (the article form's tag picker) has nothing to label it with.
			 */
			entrySaved.contents = contents.map((content) =>
				Object.assign(new TermContentEntity(), {
					term_id: entrySaved.id,
					language: content.language,
					value: content.value,
				}),
			);

			return entrySaved;
		});
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<TermEntity> & { id: EntityId },
	): Promise<TermEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(TermEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateDataWithContent(
		entry: TermEntity,
		data: ValidatorOutput<TermValidator, 'update'>,
	) {
		/*
		 * `data.type || entry.type` on both counts: an update may rename the wording, change the
		 * type, or both, and the folding rule follows the type the term ends up with - a term
		 * moved into `bundle_choice` keeps the case it was sent with from that write on.
		 */
		const contents = data.contents
			? this.normalizeContents(data.type || entry.type, data.contents)
			: undefined;

		if (contents?.length) {
			await this.assertNotDuplicate(
				data.type || entry.type,
				contents,
				entry.id,
			);
		}

		const updatedEntity = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(TermEntity);

			Object.assign(entry, pickValuesFromObject(data, entryColumns));

			const saved = await repository.save(entry);

			await TermContentRepository.saveContent(
				manager,
				contents ?? [],
				entry.id,
			);

			return saved;
		});

		// One clean for the whole operation, after commit - the content rows written above
		// have no subscriber invalidating the term's keys. See `cleanEntityCache`
		await cleanEntityCache(TermEntity, updatedEntity.id);

		return updatedEntity;
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: EntityId, withDeleted: boolean): Promise<TermEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * Two terms of the same type must not carry the same wording in the same language -
	 * "Color" as an `attribute_label` twice is one vocabulary entry, not two.
	 *
	 * The database can no longer state this: the wording moved to `term_content`, whose unique
	 * index only covers `(term_id, language)`. So the rule the old `IDX_term_unique` on
	 * `(type, language, value)` gave for free is enforced here instead, and a collision surfaces
	 * as a 409 rather than a duplicate row. The comparison is case-insensitive, which the old
	 * index was not.
	 */
	private async assertNotDuplicate(
		type: TermType,
		contents: TermContentType[],
		withoutId?: EntityId,
	): Promise<void> {
		if (!contents.length) {
			return;
		}

		const query = this.repository
			.createQuery()
			.filterBy('term.type', type)
			.filterRaw(
				`EXISTS (
					SELECT 1 FROM "term_content" "duplicate_content"
					WHERE "duplicate_content"."term_id" = "term"."id"
						AND (${contents
							.map(
								(_content, index) =>
									`("duplicate_content"."language" = :duplicateLanguage${index} AND LOWER("duplicate_content"."value") = LOWER(:duplicateValue${index}))`,
							)
							.join(' OR ')})
				)`,
				contents.reduce<Record<string, string>>(
					(parameters, content, index) => {
						parameters[`duplicateLanguage${index}`] =
							content.language;
						parameters[`duplicateValue${index}`] = content.value;

						return parameters;
					},
					{},
				),
			);

		if (withoutId) {
			query.filterBy('term.id', withoutId, '!=');
		}

		const existingTerm = await query.first();

		if (existingTerm) {
			throw new CustomError(409, lang('term.error.already_exists'));
		}
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: EntityId;
		language?: string;
		withDeleted: boolean;
	}) {
		const query = this.repository
			.createQuery()
			.select([
				'term.id',
				'term.type',
				'term.created_at',
				'term.updated_at',
				'term.deleted_at',

				'content.language',
				'content.value',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted);

		if (data.language) {
			query.joinAndSelect(
				'term.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.language,
				},
			);
		} else {
			// No language: take all contents
			query.joinAndSelect('term.contents', 'content', 'LEFT');
		}

		return await query.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<TermValidator, 'find'>,
		withDeleted: boolean,
	) {
		/*
		 * One wording per row, in the requested language - the controller always resolves one.
		 *
		 * LEFT rather than the INNER `place` uses: a term missing that language still belongs in
		 * the list with an empty value, because this table is where those gaps get found and
		 * filled. An INNER join would hide exactly the rows that need attention.
		 */
		return this.repository
			.createQuery()
			.join(
				'term.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{ language: data.filter.language },
			)
			.select([
				'term.id',
				'term.type',
				'term.created_at',
				'term.updated_at',
				'term.deleted_at',

				'content.language',
				'content.value',
			])
			.filterById(data.filter.id)
			.filterBy('term.type', data.filter.type)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const termService = new TermService(getTermRepository());
