import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError } from '@/exceptions';
import AddressEntity from '@/features/address/address.entity';
import {
	type AddressService,
	addressService,
} from '@/features/address/address.service';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import ClientAddressEntity, {
	type ClientAddressSnapshot,
	type ClientAddressType,
} from '@/features/client-address/client-address.entity';
import { getClientAddressRepository } from '@/features/client-address/client-address.repository';
import {
	type ClientAddressValidator,
	paramsUpdateList,
} from '@/features/client-address/client-address.validator';
import type PlaceEntity from '@/features/place/place.entity';
import { type PlaceType, PlaceTypeEnum } from '@/features/place/place.entity';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/** The place an address sits in, named - each level null when the chain does not reach it. */
export type AddressPlaceNames = {
	city: string | null;
	region: string | null;
	country: string | null;
};

/** A client address as the storefront lists it: the row, its street data, and the place named. */
export type ClientAddressWithPlace = ClientAddressEntity & {
	place: AddressPlaceNames;
};

/**
 * A client address points at an existing `address`, which it neither creates, edits nor removes -
 * the same address may be filed against other clients. Creating a new address is the address
 * feature's own endpoint; this one only links it.
 */
export class ClientAddressService {
	constructor(
		private repository: ReturnType<typeof getClientAddressRepository>,
		private clientService: ClientService,
		private addressService: AddressService,
	) {}

	/**
	 * Both foreign keys would otherwise surface a bad id as a masked 500. Resolving them first
	 * answers with the owning feature's 404 instead. `withDeleted` is false for both: an address
	 * must not be filed against a removed client, nor point at a removed address.
	 */
	private async checkAddressId(address_id: number): Promise<void> {
		await this.addressService.findById(address_id, false);
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<ClientAddressValidator, 'create'>,
	): Promise<ClientAddressEntity> {
		await this.clientService.findById(data.client_id, false);
		await this.checkAddressId(data.address_id);

		return this.repository.save({
			client_id: data.client_id,
			address_id: data.address_id,
			type: data.type,
			details: data.details || null,
			notes: data.notes || null,
		});
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ClientAddressEntity> & { id: number },
	): Promise<ClientAddressEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ClientAddressEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: ClientAddressEntity,
		data: ValidatorOutput<ClientAddressValidator, 'update'>,
	): Promise<ClientAddressEntity> {
		if (data.address_id) {
			await this.checkAddressId(data.address_id);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	/**
	 * Hard delete - the table has no `deleted_at`. The address it pointed at stays: it may be filed
	 * against other clients, and it is the address feature's to remove.
	 */
	public async delete(id: number): Promise<void> {
		await this.repository.createQuery().filterById(id).delete(false);
	}

	public findById(id: number): Promise<ClientAddressEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * The address with its city and up to two ancestors, each named in `language`.
	 *
	 * Two levels because `place.parent_id` lets a city hang off a region or straight off a
	 * country: walking city -> parent -> grandparent reaches the country either way, and
	 * `toPlaceNames` sorts the levels by `place_type` rather than by position.
	 */
	private createPlaceQuery(language: string) {
		return this.repository
			.createQuery()
			.joinAndSelect('client_address.address', 'address', 'INNER')
			.joinAndSelect('address.city', 'city', 'LEFT')
			.joinAndSelect(
				'city.contents',
				'city_content',
				'LEFT',
				'city_content.language = :language',
				{ language: language },
			)
			.joinAndSelect('city.parent', 'city_parent', 'LEFT')
			.joinAndSelect(
				'city_parent.contents',
				'city_parent_content',
				'LEFT',
				'city_parent_content.language = :language',
				{ language: language },
			)
			.joinAndSelect('city_parent.parent', 'city_grandparent', 'LEFT')
			.joinAndSelect(
				'city_grandparent.contents',
				'city_grandparent_content',
				'LEFT',
				'city_grandparent_content.language = :language',
				{ language: language },
			);
	}

	private toPlaceNames(entry: ClientAddressEntity): AddressPlaceNames {
		const city = entry.address?.city ?? null;

		const chain = [city, city?.parent, city?.parent?.parent].filter(
			(place): place is PlaceEntity => !!place,
		);

		const nameOf = (type: PlaceType): string | null =>
			chain.find((place) => place.place_type === type)?.contents?.[0]
				?.name ?? null;

		return {
			city: nameOf(PlaceTypeEnum.CITY),
			region: nameOf(PlaceTypeEnum.REGION),
			country: nameOf(PlaceTypeEnum.COUNTRY),
		};
	}

	private withPlace(entry: ClientAddressEntity): ClientAddressWithPlace {
		return Object.assign(entry, { place: this.toPlaceNames(entry) });
	}

	/**
	 * The ISO 3166-1 alpha-2 code of the country an address sits in, or null when the place chain
	 * does not reach one or that country has no code recorded.
	 *
	 * Read from `place.alpha2_code` rather than from the snapshot: `AddressSnapshot.address_country`
	 * is a display name frozen for a document and deliberately not an id, so it says "Romania"
	 * where a rule needs "RO". Alpha-2 rather than the alpha-3 `code` beside it, because that is
	 * the vocabulary every country rule shares - see `place.alpha2_code`.
	 * `discount.conditions.applicable_countries` is matched against this.
	 *
	 * Null rather than a 404: a buyer whose address resolves to no country simply fails every
	 * country condition, which is what failing closed means here - it is not a broken request.
	 */
	public async getCountryCodeById(id: number): Promise<string | null> {
		const entry = await this.createPlaceQuery(Configuration.language())
			.filterById(id)
			.first();

		if (!entry) {
			return null;
		}

		const city = entry.address?.city ?? null;

		const chain = [city, city?.parent, city?.parent?.parent].filter(
			(place): place is PlaceEntity => !!place,
		);

		return (
			chain.find((place) => place.place_type === PlaceTypeEnum.COUNTRY)
				?.alpha2_code ?? null
		);
	}

	/**
	 * @description Used in `find` method from the public controller; the caller has already proved the client is theirs
	 *
	 * Unpaginated, newest first: a client holds a handful of addresses.
	 */
	public async findOwn(
		clientId: number,
		type: ClientAddressType | undefined,
		language: string,
	): Promise<ClientAddressWithPlace[]> {
		const entries = await this.createPlaceQuery(language)
			.filterBy('client_address.client_id', clientId)
			.filterBy('client_address.type', type)
			.orderBy('id', 'DESC')
			.all();

		return entries.map((entry) => this.withPlace(entry));
	}

	/** One address in the shape `findOwn` lists it, for a write to answer with. */
	public async getOwnEntry(
		id: number,
		language: string,
	): Promise<ClientAddressWithPlace> {
		const entry = await this.createPlaceQuery(language)
			.filterById(id)
			.firstOrFail();

		return this.withPlace(entry);
	}

	/**
	 * An address under a client the given account holds, in one query. Somebody else's answers
	 * the same 404 a missing one does. A soft-deleted client excludes its addresses too - TypeORM
	 * applies `deleted_at IS NULL` to the joined client.
	 */
	public findOwnById(
		id: number,
		userId: number,
	): Promise<ClientAddressEntity> {
		return this.repository
			.createQuery()
			.join('client_address.client', 'client', 'INNER')
			.filterById(id)
			.filterBy('client.user_id', userId)
			.firstOrFail();
	}

	/**
	 * @description Used in `create` method from the public controller
	 *
	 * Links a picked address as the dashboard does, or writes the typed one as a new `address` row
	 * and files it in one transaction - so a failure filing it leaves no orphaned address behind.
	 * The validator guarantees exactly one branch arrives; the guard below only narrows the types.
	 */
	public async createOwn(
		data: ValidatorOutput<ClientAddressValidator, 'publicCreate'>,
	): Promise<ClientAddressEntity> {
		if (data.address_id) {
			await this.checkAddressId(data.address_id);

			return this.repository.save({
				client_id: data.client_id,
				address_id: data.address_id,
				type: data.type,
				details: data.details || null,
				notes: data.notes || null,
			});
		}

		const cityId = data.city_id;
		const street = data.street;

		if (!cityId || !street) {
			throw new BadRequestError(
				lang('client-address.validation.invalid_street'),
			);
		}

		await this.addressService.checkCityId(cityId);

		return dataSource.transaction(async (manager) => {
			const address = await manager.save(
				manager.create(AddressEntity, {
					city_id: cityId,
					details: street,
					postal_code: data.postal_code || null,
				}),
			);

			return manager.save(
				manager.create(ClientAddressEntity, {
					client_id: data.client_id,
					address_id: address.id,
					type: data.type,
					details: data.details || null,
					notes: data.notes || null,
				}),
			);
		});
	}

	/** The flattening both snapshot readers share, once the row has been resolved. */
	private toSnapshot(entry: ClientAddressEntity): ClientAddressSnapshot {
		const place = this.toPlaceNames(entry);

		const details = [entry.address?.details, entry.details]
			.filter((part): part is string => !!part)
			.join(', ');

		return {
			address_country: place.country,
			address_region: place.region,
			address_city: place.city,
			details: details || null,
			postal_code: entry.address?.postal_code ?? null,
			notes: entry.notes,
		};
	}

	/**
	 * @description Used in `updateStatus` method from `ShippingService`; the address as a shipped document freezes it
	 *
	 * By id alone: a shipment reached this point through its own `client_address_id`, and whose
	 * address it is was settled when the order was placed. Nothing here is a permission check.
	 */
	public async getSnapshotById(id: number): Promise<ClientAddressSnapshot> {
		const entry = await this.createPlaceQuery(Configuration.language())
			.filterById(id)
			.firstOrFail();

		return this.toSnapshot(entry);
	}

	/**
	 * @description Used in `toOrder` method from `CartService`; proves an address is the client's to use
	 *
	 * Resolved by id, client and type together, so an address of another client - or a delivery
	 * address offered as the billing one - is the same 404 a missing id is. Checkout calls this for
	 * the refusal rather than for the value: the order and its shipment reference the row.
	 *
	 * Place names are taken in the default content language rather than the request's: a snapshot
	 * taken from one is kept for good and read by the back office, so it has to say the same thing
	 * whichever language the shopper happened to browse in.
	 */
	public async getOrderSnapshot(
		id: number,
		clientId: number,
		type: ClientAddressType,
	): Promise<ClientAddressSnapshot> {
		const entry = await this.createPlaceQuery(Configuration.language())
			.filterById(id)
			.filterBy('client_address.client_id', clientId)
			.filterBy('client_address.type', type)
			.firstOrFail();

		return this.toSnapshot(entry);
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 *
	 * `language` selects the translation the joined city is returned in.
	 */
	public async getEntryData(data: { id: number; language: string }) {
		return await this.repository
			.createQuery()
			.joinAndSelect('client_address.client', 'client', 'LEFT')
			.joinAndSelect('client_address.address', 'address', 'INNER')
			.joinAndSelect('address.city', 'address_city', 'LEFT')
			.joinAndSelect(
				'address_city.contents',
				'address_city_content',
				'LEFT',
				'address_city_content.language = :language',
				{ language: data.language },
			)
			.filterById(data.id)
			.firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<ClientAddressValidator, 'find'>) {
		return this.repository
			.createQuery()
			.joinAndSelect('client_address.client', 'client', 'LEFT')
			.joinAndSelect('client_address.address', 'address', 'INNER')
			.joinAndSelect('address.city', 'address_city', 'LEFT')
			.joinAndSelect(
				'address_city.contents',
				'address_city_content',
				'LEFT',
				'address_city_content.language = :language',
				{ language: data.filter.language },
			)
			.filterById(data.filter.id)
			.filterBy('client_address.client_id', data.filter.client_id)
			.filterBy('client_address.address_id', data.filter.address_id)
			.filterBy('client_address.type', data.filter.type)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const clientAddressService = new ClientAddressService(
	getClientAddressRepository(),
	clientService,
	addressService,
);
