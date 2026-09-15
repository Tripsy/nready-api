import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	ClientStatusEnum,
	ClientTypeEnum,
} from '@/features/client/client.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList = [
	'client_type',
	'company_name',
	'company_cui',
	'company_reg_com',
	'person_name',
	'person_identification_number',
	'iban',
	'bank_name',
	'contact_name',
	'contact_email',
	'contact_phone',
	'notes',
];

/*
 * `client_type` discriminates the update union, so the controller fills it in from the stored
 * row whenever the body omits it - by the time the schema runs it is always present, and
 * counting it would defeat the empty-update check exactly as `id` would. It stays in
 * `paramsUpdateList` because it is genuinely updatable and the message should say so.
 */
const paramsUpdateCheckList = paramsUpdateList.filter(
	(param) => param !== 'client_type',
);

export const OrderByEnum = {
	ID: 'id',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_iban',
	'invalid_bank_name',
	'invalid_contact_name',
	'invalid_contact_email',
	'invalid_contact_phone',
	'invalid_company_name',
	'invalid_company_cui',
	'invalid_company_reg_com',
	'invalid_person_name',
	'invalid_person_identification_number',
	'invalid_type',
	'invalid_user_id',
] as const;

export class ClientValidator extends BaseValidator<typeof validatorMessages> {
	readonly baseSchema = {
		iban: this.validateIBAN(this.getMessage('invalid_iban'), {
			required: false,
		}),
		bank_name: this.validateString(this.getMessage('invalid_bank_name'), {
			required: false,
		}),
		contact_name: this.validateString(
			this.getMessage('invalid_contact_name'),
			{
				required: false,
			},
		),
		contact_email: this.validateEmail(
			this.getMessage('invalid_contact_email'),
			{
				required: false,
			},
		),
		contact_phone: this.validatePhone(
			this.getMessage('invalid_contact_phone'),
			{
				required: false,
			},
		),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	};

	private readonly companyCreateSchema = z
		.object({
			client_type: z.literal(ClientTypeEnum.COMPANY),
			company_name: this.validateString(
				this.getMessage('invalid_company_name'),
			),
			company_cui: this.validateString(
				this.getMessage('invalid_company_cui'),
			),
			company_reg_com: this.validateString(
				this.getMessage('invalid_company_reg_com'),
				{
					required: false,
				},
			),
			person_name: z.never().optional(),
			person_identification_number: z.never().optional(),
		})
		.extend(this.baseSchema);

	private readonly personCreateSchema = z
		.object({
			client_type: z.literal(ClientTypeEnum.PERSON),
			company_name: z.never().optional(),
			company_cui: z.never().optional(),
			company_reg_com: z.never().optional(),
			person_name: this.validateString(
				this.getMessage('invalid_person_name'),
			),
			person_identification_number:
				this.validatePersonalIdentificationNumber(
					this.getMessage('invalid_person_identification_number'),
					{
						required: false,
					},
				),
		})
		.extend(this.baseSchema);

	readonly create = z.discriminatedUnion('client_type', [
		this.companyCreateSchema,
		this.personCreateSchema,
	]);

	/**
	 * A shopper adding a bill-to at checkout. The owner is never taken from the body - it is the
	 * account behind the request.
	 *
	 * `person_identification_number` is refused: the duplicate check reads every client, so
	 * accepting it would answer "this CNP is already on file" to any signed-in caller who asks.
	 * An operator records it from the dashboard when an invoice needs it.
	 */
	readonly publicCreate = z.discriminatedUnion('client_type', [
		this.companyCreateSchema,
		this.personCreateSchema.extend({
			person_identification_number: z.never().optional(),
		}),
	]);

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	private readonly companyUpdateSchema = z
		.object({
			client_type: z.literal(ClientTypeEnum.COMPANY),
			company_name: this.validateString(
				this.getMessage('invalid_company_name'),
				{ required: false },
			),
			company_cui: this.validateString(
				this.getMessage('invalid_company_cui'),
				{ required: false },
			),
			company_reg_com: this.validateString(
				this.getMessage('invalid_company_reg_com'),
				{
					required: false,
				},
			),
			person_name: z.never().optional(),
			person_identification_number: z.never().optional(),
		})
		.extend(this.baseSchema);

	private readonly personUpdateSchema = z
		.object({
			client_type: z.literal(ClientTypeEnum.PERSON),
			company_name: z.never().optional(),
			company_cui: z.never().optional(),
			company_reg_com: z.never().optional(),
			person_name: this.validateString(
				this.getMessage('invalid_person_name'),
				{ required: false },
			),
			person_identification_number:
				this.validatePersonalIdentificationNumber(
					this.getMessage('invalid_person_identification_number'),
					{
						required: false,
					},
				),
		})
		.extend(this.baseSchema);

	readonly update = z
		.discriminatedUnion('client_type', [
			this.companyUpdateSchema,
			this.personUpdateSchema,
		])
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateCheckList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	/**
	 * A shopper correcting one of their own bill-to entries. `person_identification_number` is
	 * refused for the reason `publicCreate` gives: the duplicate check would answer whether any
	 * CNP is on file.
	 */
	readonly publicUpdate = z
		.discriminatedUnion('client_type', [
			this.companyUpdateSchema,
			this.personUpdateSchema.extend({
				person_identification_number: z.never().optional(),
			}),
		])
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateCheckList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList
					.filter((param) => param !== 'person_identification_number')
					.join(', '),
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
			/*
			 * A list rather than a scalar, so a caller holding several ids - the discount view
			 * naming its targets - resolves them all in one request. A single id still arrives
			 * as one.
			 */
			id: this.validateIdFilter(
				this.getMessage('invalid_ids', { name: 'id' }),
				{
					required: false,
				},
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			client_type: this.validateEnum(
				ClientTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			status: this.validateEnum(
				ClientStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			user_id: this.validateId(this.getMessage('invalid_user_id'), {
				required: false,
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
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
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

	/**
	 * The account a client belongs to - dashboard only, and the only place it is accepted.
	 *
	 * `null` is a value here rather than an absence: it is how an operator unlinks a client, so it
	 * is matched ahead of the id schema, whose preprocessing would otherwise turn it into "not
	 * sent". Required either way - the action says what the link becomes, and an omitted field
	 * would leave that unanswered.
	 */
	readonly updateAccount = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		user_id: z.union([
			z.null(),
			this.validateId(this.getMessage('invalid_user_id')),
		]),
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			ClientStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
