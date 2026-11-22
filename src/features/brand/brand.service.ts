import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import BrandEntity, {
	type BrandStatus,
	BrandStatusEnum,
	type BrandType,
	STATUS_TRANSITIONS,
} from '@/features/brand/brand.entity';
import { getBrandRepository } from '@/features/brand/brand.repository';
import {
	type BrandValidator,
	paramsUpdateList,
} from '@/features/brand/brand.validator';
import BrandContentRepository from '@/features/brand/brand-content.repository';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Columns owned by the brand row itself.
 */
const entryColumns: string[] = paramsUpdateList.filter(
	(param) => param !== 'contents',
);

export class BrandService {
	constructor(private repository: ReturnType<typeof getBrandRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<BrandValidator, 'create'>,
	): Promise<BrandEntity> {
		const existing = await this.findBySlug(data.slug, data.brand_type);

		if (existing) {
			throw new CustomError(409, lang('brand.error.already_exists'));
		}

		return dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(BrandEntity);

			const entry = {
				name: data.name,
				slug: data.slug,
				brand_type: data.brand_type,
			};

			const entrySaved = await repository.save(entry);

			await BrandContentRepository.saveContent(
				manager,
				data.contents,
				entrySaved.id,
			);

			return entrySaved;
		});
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<BrandEntity> & { id: EntityId },
	): Promise<BrandEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(BrandEntity, saved.id);

		return saved;
	}

	public async updateDataWithContent(
		entry: BrandEntity,
		data: ValidatorOutput<BrandValidator, 'update'>,
	) {
		if (data.slug || data.brand_type) {
			const existing = await this.findBySlug(
				data.slug || entry.slug,
				data.brand_type || entry.brand_type,
				entry.id,
			);

			if (existing) {
				throw new CustomError(409, lang('brand.error.already_exists'));
			}
		}

		const updatedEntity = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(BrandEntity);

			Object.assign(entry, pickValuesFromObject(data, entryColumns));

			const saved = await repository.save(entry);

			await BrandContentRepository.saveContent(
				manager,
				data.contents ?? [],
				entry.id,
			);

			return saved;
		});

		// One clean for the whole operation, after commit - the content rows written above
		// have no subscriber invalidating the brand's keys. See `cleanEntityCache`
		await cleanEntityCache(BrandEntity, updatedEntity.id);

		return updatedEntity;
	}

	public async updateStatus(
		entry: BrandEntity,
		newStatus: BrandStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;
		entry.sort_order = 0;

		await this.update(entry);
	}

	public async updateOrder(
		brand_type: BrandType,
		ids: EntityId[], // Array of IDs in the desired order
	): Promise<void> {
		await dataSource.transaction(async (manager) => {
			const brandRepository = manager.getRepository(BrandEntity);

			// Load every active brand of this type - the submitted ids must
			// be a complete reordering of this exact set, not a subset or a
			// mix of ids belonging to another brand_type.
			const brands = await brandRepository
				.createQueryBuilder('brand')
				.where('brand.brand_type = :brand_type', { brand_type })
				.andWhere('brand.status = :status', {
					status: BrandStatusEnum.ACTIVE,
				})
				.getMany();

			const foundIds = new Set(brands.map((brand) => brand.id));
			const allProvidedAreValid = ids.every((id) => foundIds.has(id));

			if (brands.length !== ids.length || !allProvidedAreValid) {
				throw new BadRequestError(
					lang('brand.validation.invalid_ids_provided'),
				);
			}

			const updatedBrands = brands.map((brand) => {
				const position = ids.indexOf(brand.id);

				brand.sort_order = ids.length - position;

				return brand;
			});

			// Save all - row by row, so each write is audited; the cache is dropped after
			// the transaction commits, below
			await brandRepository.save(updatedBrands);
		});

		// Every row moved, in one pass: a reorder rewrites the whole group, and the
		// order a reader sees comes from these rows. See `cleanEntityCacheMany`
		await cleanEntityCacheMany(BrandEntity, ids);
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	/**
	 * The unique index on `(slug, brand_type)` is partial - `WHERE deleted_at IS NULL` - so
	 * deleting a brand releases its slug straight away and another may take it. Restoring the
	 * first one then collides, and without this check the collision surfaces from the database
	 * as a masked 500 instead of the 409 `create` and `update` already answer with.
	 *
	 * `withoutId` excludes the row being restored, which matters when it is not actually
	 * deleted: it would otherwise match itself and turn a no-op restore into a conflict.
	 */
	public async restore(id: EntityId) {
		const entry = await this.findById(id, true);

		const existing = await this.findBySlug(
			entry.slug,
			entry.brand_type,
			entry.id,
		);

		if (existing) {
			throw new CustomError(409, lang('brand.error.already_exists'));
		}

		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: EntityId, withDeleted: boolean): Promise<BrandEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	public findBySlug(
		slug: string,
		brand_type: BrandType,
		withoutId?: EntityId,
	) {
		const q = this.repository
			.createQuery()
			.filterBy('slug', slug)
			.filterBy('brand_type', brand_type);

		if (withoutId) {
			q.filterBy('id', withoutId, '!=');
		}

		return q.first();
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
				'brand.id',
				'brand.name',
				'brand.slug',
				'brand.status',
				'brand.brand_type',
				'brand.created_at',
				'brand.updated_at',
				'brand.deleted_at',

				'content.language',
				'content.description',
				'content.meta',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted);

		if (data.language) {
			query.joinAndSelect(
				'brand.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.language,
				},
			);
		} else {
			// No language: take all contents
			query.joinAndSelect('brand.contents', 'content', 'LEFT');
		}

		return await query.firstOrFail();
	}

	public findByFilterPublic(
		data: ValidatorOutput<BrandValidator, 'publicFind'>,
	) {
		return this.repository
			.createQuery()
			.join(
				'brand.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.select([
				'brand.id',
				'brand.brand_type',
				'brand.name',
				'brand.slug',
				'brand.sort_order',

				'content.language',
				'content.description',
				'content.meta',
			])
			.filterBy('brand.brand_type', data.filter.brand_type)
			.filterBy('brand.status', BrandStatusEnum.ACTIVE)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}

	public findByFilter(
		data: ValidatorOutput<BrandValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.join(
				'brand.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.select([
				'brand.id',
				'brand.brand_type',
				'brand.name',
				'brand.slug',
				'brand.status',
				'brand.created_at',
				'brand.updated_at',
				'brand.deleted_at',
				'brand.sort_order',

				'content.language',
				'content.description',
				'content.meta',
			])
			.filterById(data.filter.id)
			.filterBy('brand.brand_type', data.filter.brand_type)
			.filterBy('brand.status', data.filter.status)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}
export const brandService = new BrandService(getBrandRepository());
