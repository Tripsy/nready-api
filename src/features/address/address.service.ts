import type { DeepPartial } from 'typeorm';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import AddressEntity from '@/features/address/address.entity';
import { getAddressRepository } from '@/features/address/address.repository';
import {
	type AddressValidator,
	paramsUpdateList,
} from '@/features/address/address.validator';
import { PlaceTypeEnum } from '@/features/place/place.entity';
import {
	type PlaceService,
	placeService,
} from '@/features/place/place.service';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class AddressService {
	constructor(
		private repository: ReturnType<typeof getAddressRepository>,
		private placeService: PlaceService,
	) {}

	public async checkCityId(city_id?: number) {
		if (city_id) {
			const address_city = await this.placeService.findById(
				city_id,
				true,
			);

			if (address_city.place_type !== PlaceTypeEnum.CITY) {
				throw new CustomError(
					409,
					lang('address.error.address_city_invalid_type'),
				);
			}
		}
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<AddressValidator, 'create'>,
	): Promise<AddressEntity> {
		await this.checkCityId(data.city_id);

		const entry = {
			city_id: data.city_id,
			details: data.details,
			postal_code: data.postal_code,
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<AddressEntity> & { id: number },
	): Promise<AddressEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(AddressEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: AddressEntity,
		data: ValidatorOutput<AddressValidator, 'update'>,
	) {
		if (data.city_id) {
			await this.checkCityId(data.city_id);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<AddressEntity> {
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
		language: string;
		withDeleted: boolean;
	}) {
		return await this.repository
			.createQuery()
			.joinAndSelect('address.city', 'address_city', 'LEFT')
			.joinAndSelect(
				'address_city.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language: data.language },
			)
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `find` method from the public controller - the storefront address picker
	 *
	 * Searches the whole table, as the dashboard's "Add client address" does, so a shopper can
	 * link an address somebody already filed. That is a product decision with a known cost: any
	 * signed-in account can read street addresses filed by other clients through this search.
	 *
	 * The city's parent comes along so the picker can name the county beside the city.
	 */
	public findForPicker(
		term: string,
		language: string,
		limit: number,
	): Promise<AddressEntity[]> {
		return this.repository
			.createQuery()
			.joinAndSelect('address.city', 'address_city', 'LEFT')
			.joinAndSelect(
				'address_city.contents',
				'address_city_content',
				'LEFT',
				'address_city_content.language = :language',
				{ language: language },
			)
			.joinAndSelect('address_city.parent', 'address_city_parent', 'LEFT')
			.joinAndSelect(
				'address_city_parent.contents',
				'address_city_parent_content',
				'LEFT',
				'address_city_parent_content.language = :language',
				{ language: language },
			)
			.filterByTerm(term)
			.orderBy('id', 'DESC')
			.pagination(1, limit)
			.all();
	}

	public findByFilter(
		data: ValidatorOutput<AddressValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.joinAndSelect('address.city', 'address_city', 'LEFT')
			.joinAndSelect(
				'address_city.contents',
				'address_city_content',
				'LEFT',
				'address_city_content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const addressService = new AddressService(
	getAddressRepository(),
	placeService,
);
