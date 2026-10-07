import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { ClientLedgerEntryTypeEnum } from '@/features/client-ledger/client-ledger.entity';
import { CURRENCY_CODE_CHARS } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	OCCURRED_AT: 'occurred_at',
	AMOUNT: 'amount',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_client_id',
	'invalid_entry_type',
	'invalid_currency',
	'invalid_cash_flow_id',
] as const;

/**
 * Both routes are scoped to one client by the path, so `client_id` is read from the params and
 * folded into the filter rather than accepted from the query - a ledger listing is never across
 * clients.
 */
export class ClientLedgerValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly balance = z.object({
		client_id: this.validateId(this.getMessage('invalid_client_id')),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.OCCURRED_AT,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			client_id: this.validateId(this.getMessage('invalid_client_id')),
			entry_type: this.validateEnum(
				ClientLedgerEntryTypeEnum,
				this.getMessage('invalid_entry_type'),
				{ required: false },
			),
			currency: this.validateString(this.getMessage('invalid_currency'), {
				required: false,
				minChars: CURRENCY_CODE_CHARS,
				maxChars: CURRENCY_CODE_CHARS,
			}),
			cash_flow_id: this.validateId(
				this.getMessage('invalid_cash_flow_id'),
				{ required: false },
			),
			occurred_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			occurred_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
		},
	});
}
