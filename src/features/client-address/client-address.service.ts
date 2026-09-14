import type { DeepPartial } from 'typeorm';
import {
	type AddressService,
	addressService,
} from '@/features/address/address.service';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import ClientAddressEntity from '@/features/client-address/client-address.entity';
import { getClientAddressRepository } from '@/features/client-address/client-address.repository';
import {
	type ClientAddressValidator,
	paramsUpdateList,
} from '@/features/client-address/client-address.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

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
