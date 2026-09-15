import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import PlaceEntity, {
	type PlaceType,
	PlaceTypeEnum,
} from '@/features/place/place.entity';
import { getPlaceRepository } from '@/features/place/place.repository';
import {
	type PlaceValidator,
	paramsUpdateList,
} from '@/features/place/place.validator';
import PlaceContentRepository from '@/features/place/place-content.repository';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Columns owned by the term row itself.
 */
const entryColumns: string[] = paramsUpdateList.filter(
	(param) => param !== 'contents',
);

export class PlaceService {
	constructor(private repository: ReturnType<typeof getPlaceRepository>) {}

	public async checkParentId(
		action: 'create' | 'update',
		place_type: PlaceType,
		parent_id?: number | null,
	) {
		if (place_type === PlaceTypeEnum.COUNTRY) {
			if (parent_id) {
				throw new BadRequestError(
					lang('place.validation.country_no_parent'),
				);
			}
		} else {
			if (parent_id) {
				const parentEntry = await this.repository
					.createQuery()
					.filterById(parent_id)
					.withDeleted(true)
					.first();

				if (!parentEntry) {
					throw new CustomError(
						409,
						lang('place.error.parent_not_found'),
					);
				}

				switch (place_type) {
					case PlaceTypeEnum.REGION:
						if (parentEntry.place_type !== PlaceTypeEnum.COUNTRY) {
							throw new CustomError(
								409,
								lang('place.error.invalid_parent_type'),
							);
						}
						break;
					case PlaceTypeEnum.CITY:
						if (parentEntry.place_type !== PlaceTypeEnum.REGION) {
							throw new CustomError(
								409,
								lang('place.error.invalid_parent_type'),
							);
						}
						break;
				}
			}
		}

		if (
			action === 'update' &&
			place_type !== PlaceTypeEnum.COUNTRY &&
			!parent_id
		) {
			throw new BadRequestError(lang('place.error.parent_required'));
		}
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<PlaceValidator, 'create'>,
	): Promise<PlaceEntity> {
		await this.checkParentId('create', data.place_type, data.parent_id);

		return dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(PlaceEntity);

			const entry = {
				place_type: data.place_type,
				code: data.code,
				parent_id: data.parent_id,
			};

			const entrySaved = await repository.save(entry);

			await PlaceContentRepository.saveContent(
				manager,
				data.contents,
				entrySaved.id,
			);

			return entrySaved;
		});
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateDataWithContent(
		entry: PlaceEntity,
		data: ValidatorOutput<PlaceValidator, 'update'>,
	) {
		await this.checkParentId(
			'update',
			data.place_type || entry.place_type,
			data.parent_id || entry.parent_id,
		);

		const isTypeChange =
			data.place_type !== undefined &&
			data.place_type !== entry.place_type;

		if (isTypeChange) {
			const hasChildren = await this.hasChildren(entry.id);

			if (hasChildren) {
				throw new BadRequestError(
					lang('place.error.cannot_change_type_with_children'),
				);
			}
		}

		const updatedEntity = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(PlaceEntity); // We use the manager -> `getPlaceRepository` is not bound to the transaction

			Object.assign(entry, pickValuesFromObject(data, entryColumns));

			const saved = await repository.save(entry);

			await PlaceContentRepository.saveContent(
				manager,
				data.contents ?? [],
				entry.id,
			);

			return saved;
		});

		// One clean for the whole operation, after commit - the content rows written above
		// have no subscriber invalidating the place's keys. See `cleanEntityCache`
		await cleanEntityCache(PlaceEntity, updatedEntity.id);

		return updatedEntity;
	}

	public async delete(id: number) {
		const hasChildren = await this.hasChildren(id);

		if (hasChildren) {
			throw new BadRequestError(
				lang('place.error.cannot_delete_with_children'),
			);
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<PlaceEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: number;
		language?: string;
		withDeleted: boolean;
	}) {
		const query = this.repository
			.createQuery()
			.select([
				'place.id',
				'place.place_type',
				'place.code',
				'place.parent_id',
				'place.created_at',
				'place.updated_at',
				'place.deleted_at',
				'content.language',
				'content.name',
				'content.type_label',

				'parent.id',
				'parent.place_type',
				'parentContent.language',
				'parentContent.name',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			/*
			 * The parent comes back as a relation, not just the `parent_id` column: the update
			 * form has to render its name in the autocomplete, and the id alone leaves it with
			 * nothing to display. `parentContent` carries every language, since the form labels
			 * the parent in whichever one the user is editing.
			 */
			.joinAndSelect('place.parent', 'parent', 'LEFT')
			.joinAndSelect('parent.contents', 'parentContent', 'LEFT');

		if (data.language) {
			query.joinAndSelect(
				'place.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language: data.language },
			);
		} else {
			// No language: take all contents
			query.joinAndSelect('place.contents', 'content', 'LEFT');
		}

		return await query.firstOrFail();
	}

	/**
	 * @description Used in `find` method from the public controller - the storefront city picker
	 *
	 * The same projection the dashboard listing selects, narrowed to cities and one page. The
	 * parent comes along so a picker can tell two cities of the same name apart by their county.
	 * Deleted places are never offered.
	 */
	public findCities(
		term: string,
		language: string,
		limit: number,
	): Promise<PlaceEntity[]> {
		return this.repository
			.createQuery()
			.join(
				'place.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language: language },
			)
			.join('place.parent', 'parent', 'LEFT')
			.join(
				'parent.contents',
				'parentContent',
				'LEFT',
				'parentContent.language = :language',
				{ language: language },
			)
			.select([
				'place.id',
				'place.place_type',
				'place.code',

				'content.language',
				'content.name',
				'content.type_label',

				'parent.id',
				'parent.place_type',
				'parent.code',

				'parentContent.language',
				'parentContent.name',
				'parentContent.type_label',
			])
			.filterBy('place.place_type', PlaceTypeEnum.CITY)
			.filterByTerm(term)
			.orderBy('id', 'ASC')
			.pagination(1, limit)
			.all();
	}

	public hasChildren(id: number) {
		return this.repository
			.createQuery()
			.filterBy('parent_id', id)
			.firstRaw();
	}

	public findByFilter(
		data: ValidatorOutput<PlaceValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.join(
				'place.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.join('place.parent', 'parent', 'LEFT')
			.join(
				'parent.contents',
				'parentContent',
				'LEFT',
				'parentContent.language = :language',
				{
					language: data.filter.language,
				},
			)
			.select([
				'place.id',
				'place.place_type',
				'place.code',
				'place.created_at',
				'place.deleted_at',

				'content.language',
				'content.name',
				'content.type_label',

				'parent.id',
				'parent.place_type',
				'parent.code',

				'parentContent.name',
				'parentContent.type_label',
			])
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.filterBy('place.place_type', data.filter.place_type)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const placeService = new PlaceService(getPlaceRepository());
