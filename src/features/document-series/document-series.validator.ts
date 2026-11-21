import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * `document_type` and `next_number` are absent on purpose. The first is the key the counter is
 * stored under - editing it would move already-issued numbers to a different series - and the
 * counter itself only ever moves through an allocation. A series that has to start from a legacy
 * number is created with `start_number` set.
 */
export const paramsUpdateList: string[] = ['code', 'start_number', 'notes'];

export const OrderByEnum = {
	ID: 'id',
	CODE: 'code',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_document_type',
	'invalid_code',
	'invalid_start_number',
] as const;

const CODE_MAX_CHARS = 10;

export class DocumentSeriesValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		document_type: this.validateEnum(
			DocumentTypeEnum,
			this.getMessage('invalid_document_type'),
		),
		code: this.validateString(this.getMessage('invalid_code'), {
			maxChars: CODE_MAX_CHARS,
		}),
		start_number: this.validateNumber(
			this.getMessage('invalid_start_number'),
			{ required: false },
		).default(1),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			code: this.validateString(this.getMessage('invalid_code'), {
				required: false,
				maxChars: CODE_MAX_CHARS,
			}),
			start_number: this.validateNumber(
				this.getMessage('invalid_start_number'),
				{ required: false },
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
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
			document_type: this.validateEnum(
				DocumentTypeEnum,
				this.getMessage('invalid_document_type'),
				{ required: false },
			),
		},
	});
}
