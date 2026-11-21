import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { CronHistoryStatusEnum } from '@/features/cron-history/cron-history.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	LABEL: 'label',
	START_AT: 'start_at',
} as const;

const validatorMessages = [...sharedValidatorMessages];

export class CronHistoryValidator extends BaseValidator<
	typeof validatorMessages
> {
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
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			status: this.validateEnum(
				CronHistoryStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			start_date_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			start_date_end: this.validateDate(
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
			data.filter?.start_date_start &&
			data.filter?.start_date_end &&
			data.filter.start_date_start > data.filter.start_date_end
		) {
			ctx.addIssue({
				path: ['filter', 'create_at_start'],
				message: this.getMessage('invalid_date_range'),
				code: 'custom',
			});
		}
	});
}
