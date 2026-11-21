import type { DeepPartial } from 'typeorm';
import { lang } from '@/config/message.setup';
import { CustomError, NotFoundError } from '@/exceptions';
import {
	type AccountTokenService,
	accountTokenService,
} from '@/features/account/account-token.service';
import UserEntity, {
	STATUS_TRANSITIONS,
	type UserStatus,
} from '@/features/user/user.entity';
import { getUserRepository } from '@/features/user/user.repository';
import {
	paramsUpdateList,
	type UserValidator,
} from '@/features/user/user.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';
import { UserRoleEnum } from '@/shared/types/user-role.type';

export class UserService {
	constructor(
		private repository: ReturnType<typeof getUserRepository>,
		private accountTokenService: AccountTokenService,
	) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<UserValidator, 'create'>,
	): Promise<UserEntity> {
		const existingEntry = await this.findByEmail(data.email);

		if (existingEntry) {
			throw new CustomError(409, lang('user.error.email_already_used'));
		}

		const entry = {
			name: data.name,
			email: data.email,
			password: data.password,
			status: data.status,
			role: data.role,

			...(data.role === UserRoleEnum.OPERATOR &&
				data.operator_type && {
					operator_type: data.operator_type,
				}),

			...(data.language && {
				language: data.language,
			}),
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Used in `register` method from controller;
	 */
	public async createRegister(
		entry: Partial<UserEntity>,
	): Promise<UserEntity> {
		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<UserEntity> & { id: EntityId },
	): Promise<UserEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(UserEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: UserEntity,
		data: ValidatorOutput<UserValidator, 'update'>,
	) {
		if (data.email) {
			const existing = await this.findByEmail(data.email, entry.id);

			if (existing) {
				throw new CustomError(
					409,
					lang('user.error.email_already_used'),
				);
			}
		}

		if (data.password || data.email !== entry.email) {
			try {
				await this.accountTokenService.removeAccountTokenForUser(
					entry.id,
				); // Note: Removes all account tokens for the user
			} catch (error) {
				// Do nothing if the user has no account tokens
				if (!(error instanceof NotFoundError)) {
					throw error;
				}
			}
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	public async updateStatus(
		entry: UserEntity,
		newStatus: UserStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(
		id: EntityId,
		withDeleted: boolean = false,
	): Promise<UserEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Same as `findById`, but with the `password` column loaded.
	 *
	 * `password` is declared `select: false`, so the default query never returns it - a
	 * caller that has to verify a password (or find out whether the account has one at all,
	 * now that social sign-in accounts may not) must ask for the column explicitly.
	 */
	public findByIdWithPassword(id: EntityId): Promise<UserEntity> {
		return this.repository
			.createQuery()
			.select(['id', 'name', 'email', 'language', 'status', 'password'])
			.filterById(id)
			.firstOrFail();
	}

	public findByEmail(email: string, withoutId?: EntityId, select?: string[]) {
		const q = this.repository
			.createQuery()
			.filterByEmail(email)
			.withDeleted(true);

		if (withoutId) {
			q.filterBy('id', withoutId, '!=');
		}

		if (select) {
			q.select(select);
		}

		return q.first();
	}

	public findByFilter(
		data: ValidatorOutput<UserValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterByStatus(data.filter.status)
			.filterBy('role', data.filter.role)
			.filterByRange(
				'created_at',
				data.filter.create_at_start,
				data.filter.create_at_end,
			)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const userService = new UserService(
	getUserRepository(),
	accountTokenService,
);
