import { z } from 'zod';
import { lang } from '@/config/message.setup';
import { RequestContextSourceEnum } from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	ENTITY: 'entity',
	ACTION: 'action',
	RECORDED_AT: 'recorded_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_source',
] as const;

export class LogHistoryValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly delete = z.object({
		ids: z.array(
			this.validateId(
				lang('shared.validation.invalid_ids', {
					name: 'ids',
				}),
			),
			{
				message: lang('shared.validation.invalid_ids', {
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
			entity: this.validateString(this.getMessage('invalid_string'), {
				required: false,
			}),
			entity_id: this.validateId(this.getMessage('invalid_number'), {
				required: false,
			}),
			action: this.validateString(this.getMessage('invalid_string'), {
				required: false,
			}),
			request_id: this.validateString(this.getMessage('invalid_string'), {
				required: false,
			}),
			source: this.validateEnum(
				RequestContextSourceEnum,
				this.getMessage('invalid_source'),
				{ required: false },
			),
			recorded_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			recorded_at_end: this.validateDate(
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
			data.filter?.recorded_at_start &&
			data.filter?.recorded_at_end &&
			data.filter.recorded_at_start > data.filter.recorded_at_end
		) {
			ctx.addIssue({
				path: ['filter', 'recorded_at_start'],
				message: this.getMessage('invalid_date_range'),
				code: 'custom',
			});
		}
	});
}
