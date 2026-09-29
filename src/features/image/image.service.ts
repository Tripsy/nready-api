import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { BadRequestError, NotFoundError } from '@/exceptions';
import ImageEntity, {
	type ImageSection,
	type ImageStatus,
	ImageStatusEnum,
	type ImageType,
	ImageTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/image/image.entity';
import { getImageRepository } from '@/features/image/image.repository';
import type { ImageValidator } from '@/features/image/image.validator';
import ImageContentRepository from '@/features/image/image-content.repository';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { TargetImage } from '@/shared/registries/target-image.registry';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class ImageService {
	constructor(private repository: ReturnType<typeof getImageRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<ImageValidator, 'create'>,
	): Promise<ImageEntity> {
		return dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ImageEntity);

			const entry = {
				section: data.section,
				entity_id: data.entity_id,
				image_type: data.image_type,
				storage: data.storage,
				path: data.path,
				properties: data.properties,
				sort_order: data.sort_order,
			};

			const entrySaved = await repository.save(entry);

			await ImageContentRepository.saveContent(
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
		data: DeepPartial<ImageEntity> & { id: number },
	): Promise<ImageEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ImageEntity, saved.id);

		return saved;
	}

	public async updateDataWithContent(
		entry: ImageEntity,
		data: ValidatorOutput<ImageValidator, 'update'>,
	) {
		await dataSource.transaction(async (manager) => {
			await ImageContentRepository.saveContent(
				manager,
				data.contents,
				entry.id,
			);
		});

		// One clean for the whole operation, after commit - the content rows written above
		// have no subscriber invalidating the image's keys, and the image row itself was not
		// touched, so nothing else would. See `cleanEntityCache`
		await cleanEntityCache(ImageEntity, entry.id);

		return entry;
	}

	public async updateStatus(
		entry: ImageEntity,
		newStatus: ImageStatus,
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
		section: ImageSection,
		entity_id: number,
		positions: { id: number; sort_order: number }[],
	): Promise<void> {
		const ids = positions.map((p) => p.id);

		if (ids.length === 0) {
			return;
		}

		await dataSource.transaction(async (manager) => {
			const imageRepository = manager.getRepository(ImageEntity);

			// Load all images with ownership check in one query
			const images = await imageRepository
				.createQueryBuilder('image')
				.where('image.id IN (:...ids)', { ids })
				.andWhere('image.section = :section', { section })
				.andWhere('image.entity_id = :entity_id', { entity_id })
				.andWhere('image.image_type = :imageType', {
					imageType: ImageTypeEnum.GALLERY,
				})
				.getMany();

			// Validate all images exist and belong to this entity
			const foundIds = new Set(images.map((img) => img.id));
			const allFound = ids.every((id) => foundIds.has(id));

			if (!allFound) {
				const missingIds = ids.filter((id) => !foundIds.has(id));

				throw new BadRequestError(
					`Invalid image IDs: ${missingIds.join(', ')}`,
				);
			}

			// Update sort_order
			const updatedImages = images.map((image) => {
				const position = positions.find((p) => p.id === image.id);

				if (position) {
					image.sort_order = position.sort_order;
				}

				return image;
			});

			// Save all - row by row, so each write is audited; the cache is dropped after
			// the transaction commits, below
			await imageRepository.save(updatedImages);
		});

		// Every row moved, in one pass: a reorder rewrites the whole group, and the
		// order a reader sees comes from these rows. See `cleanEntityCacheMany`
		await cleanEntityCacheMany(ImageEntity, ids);
	}

	/**
	 * @description Used by `image.bootstrap.ts`, through the target-image registry
	 *
	 * The one image that stands for each named target: the first active image of the requested
	 * type, by `sort_order`. A target with none is absent from the map, and the caller renders
	 * that as `null`.
	 *
	 * The type is the caller's to choose - a brand wants its `logo`, an article the first of its
	 * `gallery` - while "first active, by `sort_order`" is this table's rule and stays here.
	 *
	 * Reads the gallery and keeps the head of each. The whole set is one index seek either way, so
	 * a second narrower statement would buy nothing and cost the two answers agreeing.
	 */
	public async getPrimaryByTargets(
		section: ImageSection,
		imageType: ImageType,
		entityIds: number[],
	): Promise<Map<number, TargetImage>> {
		const galleries = await this.getGalleryByTargets(
			section,
			imageType,
			entityIds,
		);

		const primary = new Map<number, TargetImage>();

		// The first of each gallery, which `getGalleryByTargets` has already ordered - so "the
		// picture that stands for this row" and "the first picture of this row" cannot drift.
		for (const [entityId, images] of galleries) {
			if (images.length > 0) {
				primary.set(entityId, images[0]);
			}
		}

		return primary;
	}

	/**
	 * @description Used by `image.bootstrap.ts`, through the target-image registry
	 *
	 * Every active image of the requested type each named target carries, in the order it shows
	 * them. A target with none is absent from the map rather than present with an empty list, so
	 * it reads the same way `getPrimaryByTargets` does.
	 *
	 * What a detail page wants, where the listing wants the primary alone. One statement for the
	 * whole set, and a separate statement rather than a join: `image` is polymorphic
	 * (`section` + `entity_id`, no foreign key to anything), so there is no relation for the query
	 * builder to walk. It costs a single index seek on `IDX_image_type_id`.
	 */
	public async getGalleryByTargets(
		section: ImageSection,
		imageType: ImageType,
		entityIds: number[],
	): Promise<Map<number, TargetImage[]>> {
		const galleries = new Map<number, TargetImage[]>();

		if (entityIds.length === 0) {
			return galleries;
		}

		const images = await this.repository
			.createQuery()
			.select([
				'image.id',
				'image.entity_id',
				'image.path',
				'image.storage',
				'image.properties',
				'image.sort_order',
			])
			.filterBy('image.section', section)
			.filterBy('image.image_type', imageType)
			.filterBy('image.status', ImageStatusEnum.ACTIVE)
			.filterBy('image.entity_id', entityIds, 'IN')
			.orderBy('image.sort_order', 'DESC')
			.all();

		/*
		 * Descending, because that is the direction the gallery is stamped in: the manager lists
		 * `sort_order DESC` and renumbers the set as `length - index`, so the image an editor
		 * dragged to the front carries the *highest* number. Read ascending, this returns the
		 * gallery back to front, and its first image is the card the editor had put last.
		 *
		 * `updateStatus` reads the same way round - it resets `sort_order` to 0 when an image is
		 * deactivated, so a re-activated one rejoins at the back rather than silently becoming
		 * the picture that stands for the whole target.
		 */
		for (const image of images) {
			const entry: TargetImage = {
				id: image.id,
				path: image.path,
				storage: image.storage,
				properties: image.properties ?? null,
			};

			const gallery = galleries.get(image.entity_id);

			if (gallery) {
				gallery.push(entry);
			} else {
				galleries.set(image.entity_id, [entry]);
			}
		}

		return galleries;
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete(false);
	}

	/**
	 * @description Used by `ImageListener`, on `entityRemoved`
	 *
	 * Images left pointing at targets that no longer exist. `(section, entity_id)` carries no
	 * foreign key, so nothing removes them when the target goes - the feature that owned it
	 * announces the removal and this clears what was filed against it. The translations follow
	 * through `image_content.image_id`'s `ON DELETE CASCADE`.
	 *
	 * Hard, like every other delete on this table: there is no `deleted_at` to soft-delete into,
	 * and a lingering row would keep answering `getPrimaryByTargets` for an id a later row may
	 * reuse.
	 *
	 * Clears the rows only. The stored file behind `path` stays on disk or in S3, exactly as the
	 * dashboard `delete` above leaves it - reaping storage is a separate job neither of them does.
	 */
	public async deleteByTargets(
		section: ImageSection,
		entityIds: number[],
	): Promise<void> {
		if (entityIds.length === 0) {
			return;
		}

		try {
			await this.repository
				.createQuery()
				.filterBy('image.section', section)
				.filterBy('image.entity_id', entityIds, 'IN')
				.delete(false, true);
		} catch (error) {
			/*
			 * A target with no images is the ordinary case, and `RepositoryAbstract.delete`
			 * reports "nothing matched" as a 404 - meaningful when a caller named one row, noise
			 * when the caller is a cleanup sweeping ids it has no expectations about.
			 */
			if (!(error instanceof NotFoundError)) {
				throw error;
			}
		}
	}

	public findById(id: number): Promise<ImageEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: number; language?: string }) {
		const query = this.repository.createQuery().filterById(data.id);

		if (data.language) {
			query.joinAndSelect(
				'image.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.language,
				},
			);
		} else {
			// No language: take all contents
			query.joinAndSelect('image.contents', 'content', 'LEFT');
		}

		return await query.firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<ImageValidator, 'find'>) {
		const query = this.repository
			.createQuery()
			.join('image.contents', 'content', 'LEFT')
			.select([
				'image.id',
				'image.section',
				'image.entity_id',
				'image.image_type',
				'image.storage',
				'image.path',
				'image.properties',
				'image.status',
				'image.sort_order',
				'image.created_at',
				'image.updated_at',

				'content.id',
				'content.language',
				'content.title',
				'content.description',
			])
			.filterById(data.filter.id)
			.filterBy('image.entity_id', data.filter.entity_id)
			.filterBy('image.section', data.filter.section)
			.filterBy('image.image_type', data.filter.image_type)
			.filterBy('image.status', data.filter.status)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit);

		if (data.filter.language) {
			query.filterBy('content.language', data.filter.language);
		}

		return query.all(true);
	}
}
export const imageService = new ImageService(getImageRepository());
