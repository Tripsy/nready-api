import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';
import {
	LogDataCategoryEnum,
	LogDataLevelEnum,
} from '@/shared/types/log-data.type';

export const OrderByEnum = {
	ID: 'id',
	REQUEST_ID: 'request_id',
	CATEGORY: 'category',
	LEVEL: 'level',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_category',
	'invalid_level',
] as const;

export class LogDataValidator extends BaseValidator<typeof validatorMessages> {
	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly delete = z.object({
		ids: z.array(
			this.validateId(
				this.getMessage('invalid_ids', {
					name: 'ids',
				}),
			),
			{
				message: this.getMessage('invalid_ids', {
					name: 'ids',
				}),
			},
		),
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
			category: this.validateEnum(
				LogDataCategoryEnum,
				this.getMessage('invalid_category'),
				{ required: false },
			),
			level: this.validateEnum(
				LogDataLevelEnum,
				this.getMessage('invalid_level'),
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			create_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			create_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
		},
	}).superRefine((data, ctx) => {
		if (
			data.filter?.create_at_start &&
			data.filter?.create_at_end &&
			data.filter.create_at_start > data.filter.create_at_end
		) {
			ctx.addIssue({
				path: ['filter', 'create_at_start'],
				message: this.getMessage('invalid_date_range'),
				code: 'custom',
			});
		}
	});
}
