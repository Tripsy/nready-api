import type { DeepPartial } from 'typeorm';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import ClientEntity, {
	type ClientIdentityData,
	type ClientStatus,
	ClientStatusEnum,
	ClientTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/client/client.entity';
import { getClientRepository } from '@/features/client/client.repository';
import {
	type ClientValidator,
	paramsUpdateList,
} from '@/features/client/client.validator';
import { type UserService, userService } from '@/features/user/user.service';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class ClientService {
	constructor(
		private repository: ReturnType<typeof getClientRepository>,
		private userService: UserService,
	) {}

	public async checkDuplicate(data: ClientIdentityData, withoutId?: number) {
		const query = this.repository
			.createQuery()
			.filterBy('client_type', data.client_type);

		if (withoutId) {
			query.filterBy('id', withoutId, '!=');
		}

		if (data.client_type === ClientTypeEnum.COMPANY) {
			// `company_cui` is usually required but we do the check anyway
			if (
				!data.company_name &&
				!data.company_cui &&
				!data.company_reg_com
			) {
				return;
			}

			query.filterAny([
				{
					column: 'company_name',
					value: data.company_name,
					operator: '=',
				},
				{
					column: 'company_cui',
					value: data.company_cui,
					operator: '=',
				},
				{
					column: 'company_reg_com',
					value: data.company_reg_com,
					operator: '=',
				},
			]);
		} else {
			// if `person_identification_number` is not present the check doesn't make sense
			if (!data.person_identification_number) {
				return;
			}

			query.filterBy(
				'person_identification_number',
				data.person_identification_number,
			);
		}

		query.withDeleted();

		if ((await query.count()) > 0) {
			throw new CustomError(409, lang('client.error.already_exists'));
		}
	}

	/**
	 * @description Used in `create` method from both controllers
	 *
	 * `user_id` is the account the storefront creates the client for - the caller behind the
	 * request, never a body field. It is taken on trust rather than resolved through
	 * `userService`: auth has already established that account, so a lookup here would be one
	 * wasted query per create. This is why it differs from `updateAccount`, where an operator
	 * names an arbitrary account that may not exist. The dashboard passes nothing and the client
	 * is stored unclaimed.
	 */
	public async create(
		data: ValidatorOutput<ClientValidator, 'create'>,
		user_id?: number,
	): Promise<ClientEntity> {
		const identityData: ClientIdentityData =
			data.client_type === ClientTypeEnum.COMPANY
				? {
						client_type: ClientTypeEnum.COMPANY,
						company_name: data.company_name,
						company_cui: data.company_cui,
						company_reg_com: data.company_reg_com,
					}
				: {
						client_type: ClientTypeEnum.PERSON,
						person_identification_number:
							data.person_identification_number,
					};

		await this.checkDuplicate(identityData);

		const entry = {
			...data,
			status: ClientStatusEnum.ACTIVE,
			user_id: user_id ?? null,
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ClientEntity> & { id: number },
	): Promise<ClientEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ClientEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: ClientEntity,
		data: ValidatorOutput<ClientValidator, 'update'>,
	) {
		const identityData: ClientIdentityData =
			data.client_type === ClientTypeEnum.COMPANY
				? {
						client_type: ClientTypeEnum.COMPANY,
						company_name: data.company_name,
						company_cui: data.company_cui,
						company_reg_com: data.company_reg_com,
					}
				: {
						client_type: ClientTypeEnum.PERSON,
						person_identification_number:
							data.person_identification_number,
					};

		await this.checkDuplicate(identityData, entry.id);

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	/**
	 * Links the client to an account, or unlinks it when `user_id` is null.
	 */
	public async updateAccount(
		entry: ClientEntity,
		user_id: number | null,
	): Promise<ClientEntity> {
		if (user_id) {
			await this.userService.findById(user_id, false);
		}

		entry.user_id = user_id;

		return this.update(entry);
	}

	public async updateStatus(
		entry: ClientEntity,
		newStatus: ClientStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<ClientEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `find` method from the public controller - the bill-to choices at checkout
	 *
	 * Unpaginated: scoped to one account through `IDX_client_user_id`, and an account holds a
	 * handful of clients, not a listing's worth.
	 */
	public findOwn(user_id: number): Promise<ClientEntity[]> {
		return this.repository
			.createQuery()
			.filterBy('user_id', user_id)
			.orderBy('id', 'DESC')
			.all();
	}

	/**
	 * A client the given account holds. Somebody else's client answers the same 404 a missing one
	 * does, so a caller learns nothing about rows they cannot use.
	 */
	public findOwnById(id: number, user_id: number): Promise<ClientEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.filterBy('user_id', user_id)
			.firstOrFail();
	}

	public async getEntryData(data: { id: number; withDeleted: boolean }) {
		const entry = await this.repository
			.createQuery()
			// The linked account, so the window names it rather than printing an id
			.join('client.user', 'user', 'LEFT')
			.addSelect(['user.id', 'user.name', 'user.email'])
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();

		if (entry.client_type === ClientTypeEnum.COMPANY) {
			delete entry.person_name;
			delete entry.person_identification_number;
		} else {
			delete entry.company_name;
			delete entry.company_cui;
			delete entry.company_reg_com;
		}

		return entry;
	}

	public findByFilter(
		data: ValidatorOutput<ClientValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.join('client.user', 'user', 'LEFT')
			.addSelect(['user.id', 'user.name', 'user.email'])
			.filterById(data.filter.id)
			.filterBy('client_type', data.filter.client_type)
			.filterByStatus(data.filter.status)
			.filterBy('user_id', data.filter.user_id)
			.filterByRange(
				'created_at',
				data.filter.create_at_start,
				data.filter.create_at_end,
			)
			.filterByTerm(data.filter.term, data.filter.client_type)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const clientService = new ClientService(
	getClientRepository(),
	userService,
);
