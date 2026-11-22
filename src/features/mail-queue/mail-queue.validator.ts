import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { MailQueueStatusEnum } from '@/features/mail-queue/mail-queue.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	TEMPLATE_ID: 'template_id',
	SENT_AT: 'sent_at',
} as const;

const validatorMessages = [...sharedValidatorMessages] as const;

export class MailQueueValidator extends BaseValidator<
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
			template: z.string().trim().optional(),
			status: this.validateEnum(
				MailQueueStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			content: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			to: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			sent_date_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			sent_date_end: this.validateDate(
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
			data.filter?.sent_date_start &&
			data.filter?.sent_date_end &&
			data.filter.sent_date_start > data.filter.sent_date_end
		) {
			ctx.addIssue({
				path: ['filter', 'sent_date_start'],
				message: this.getMessage('invalid_date_range'),
				code: 'custom',
			});
		}
	});
}
