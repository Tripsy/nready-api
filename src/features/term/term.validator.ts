import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { TermTypeEnum } from '@/features/term/term.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = ['type', 'contents'];

export const OrderByEnum = {
	ID: 'id',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_type',
	'invalid_value',
] as const;

/** Matches the `term_content.value` column width, so a rejected input never reaches the database. */
const VALUE_MAX_CHARS = 255;

export class TermValidator extends BaseValidator<typeof validatorMessages> {
	/*
	 * Trimmed here and case-folded in `TermService.normalizeContents`, which is where the term's
	 * `type` is in reach - most types are stored lower-cased, `bundle_choice` is not, and this
	 * schema cannot see which it is. On an update the payload may not carry `type` at all, so
	 * only the service, holding the existing row, can decide.
	 */
	readonly contentsSchema = z.object({
		language: this.validateLanguage(this.getMessage('invalid_language')),
		value: this.validateString(this.getMessage('invalid_value'), {
			maxChars: VALUE_MAX_CHARS,
		}).transform((value) => value.trim()),
	});

	readonly create = z.object({
		type: this.validateEnum(TermTypeEnum, this.getMessage('invalid_type')),
		contents: this.contentsSchema
			.array()
			.min(1, this.getMessage('invalid_contents'))
			.refine(
				(contents) => {
					const languages = contents.map(
						(content) => content.language,
					);

					return new Set(languages).size === languages.length;
				},
				{ message: this.getMessage('duplicate_contents') },
			),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			type: this.validateEnum(
				TermTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			contents: this.contentsSchema
				.array()
				.refine(
					(contents) => {
						const languages = contents.map(
							(content) => content.language,
						);

						return new Set(languages).size === languages.length;
					},
					{ message: this.getMessage('duplicate_contents') },
				)
				.optional(),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' }), {
				required: false,
			}),
			type: this.validateEnum(
				TermTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});
}
