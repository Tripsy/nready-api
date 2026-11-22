import type { DeepPartial } from 'typeorm';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type { TemplateType } from '@/features/template/template.entity';
import TemplateEntity from '@/features/template/template.entity';
import { getTemplateRepository } from '@/features/template/template.repository';
import {
	paramsUpdateList,
	type TemplateValidator,
} from '@/features/template/template.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import {
	cleanEntityCache,
	cleanEntityCacheBy,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class TemplateService {
	constructor(private repository: ReturnType<typeof getTemplateRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<TemplateValidator, 'create'>,
	): Promise<TemplateEntity> {
		const existingTemplate = await this.checkIfExist(
			data.label,
			data.language,
			data.type,
		);

		if (existingTemplate) {
			throw new CustomError(409, lang('template.error.already_exists'));
		}

		const entry = {
			label: data.label,
			language: data.language,
			type: data.type,
			content: data.content,
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<TemplateEntity> & { id: EntityId },
	): Promise<TemplateEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(TemplateEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: TemplateEntity,
		data: ValidatorOutput<TemplateValidator, 'update'>,
	) {
		const existingTemplate = await this.checkIfExist(
			data.label || entry.label,
			data.language || entry.language,
			data.type || entry.type,
			entry.id,
		);

		if (existingTemplate) {
			throw new CustomError(409, lang('template.error.already_exists'));
		}

		/*
		 * Captured before the assign below overwrites them. A template is read by
		 * label/language/type at render time, not by id, and an edit that renames it would
		 * otherwise leave the *old* name serving the old body until its TTL - the row the id
		 * clean drops is not the one that lookup reads.
		 */
		const previous = this.lookupKey(entry);

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		const saved = await this.update(entry);

		await cleanEntityCacheBy(TemplateEntity, ...previous);

		const current = this.lookupKey(saved);

		// Only when the rename actually happened; otherwise this is a second scan of the
		// keyspace for the key the line above has already dropped.
		if (current.join(':') !== previous.join(':')) {
			await cleanEntityCacheBy(TemplateEntity, ...current);
		}

		return saved;
	}

	/** The segments `template-public.controller.ts` builds its render-time cache key from. */
	private lookupKey(entry: TemplateEntity): [string, string, string] {
		return [entry.label, entry.language, entry.type];
	}

	public async delete(id: EntityId) {
		// Loaded first: the terminal drops `template:<id>*`, but the render-time lookup is
		// keyed by label and only this row knows what that label is.
		const entry = await this.findById(id, true);

		await this.repository.createQuery().filterById(id).delete();

		await cleanEntityCacheBy(TemplateEntity, ...this.lookupKey(entry));
	}

	public async restore(id: EntityId) {
		const entry = await this.findById(id, true);

		await this.repository.createQuery().filterById(id).restore();

		await cleanEntityCacheBy(TemplateEntity, ...this.lookupKey(entry));
	}

	public findById(
		id: EntityId,
		withDeleted: boolean,
	): Promise<TemplateEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	public findByLabel(
		label: string,
		language: string,
		type: TemplateType,
	): Promise<TemplateEntity> {
		return this.repository
			.createQuery()
			.filterBy('label', label)
			.filterBy('language', language)
			.filterBy('type', type)
			.firstOrFail();
	}

	public checkIfExist(
		label: string,
		language: string,
		type: TemplateType,
		withoutId?: EntityId,
	) {
		const q = this.repository
			.createQuery()
			.filterBy('label', label)
			.filterBy('language', language)
			.filterBy('type', type)
			.withDeleted();

		if (withoutId) {
			q.filterBy('id', withoutId, '!=');
		}

		return q.first();
	}

	public findByFilter(
		data: ValidatorOutput<TemplateValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterBy('language', data.filter.language)
			.filterBy('type', data.filter.type)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const templateService = new TemplateService(getTemplateRepository());
