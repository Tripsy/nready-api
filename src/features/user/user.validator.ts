import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	UserOperatorTypeEnum,
	UserStatusEnum,
} from '@/features/user/user.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';
import { UserRoleEnum } from '@/shared/types/user-role.type';

export const paramsUpdateList: string[] = [
	'name',
	'email',
	'password',
	'language',
	'status',
	'role',
	'operator_type',
];

export const OrderByEnum = {
	ID: 'id',
	NAME: 'name',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_name',
	'name_min',
	'invalid_email',
	'invalid_password',
	'password_min',
	'password_condition_capital_letter',
	'password_condition_number',
	'password_condition_special_character',
	'password_confirm_mismatch',
	'password_confirm_required',
	'invalid_role',
	'invalid_operator_type',
	'operator_type_required',
	'operator_type_only_for_operator',
] as const;

export class UserValidator extends BaseValidator<typeof validatorMessages> {
	readonly create = z
		.object({
			name: this.validateString(
				{
					invalid: this.getMessage('invalid_name'),
					min_chars: this.getMessage('name_min'),
				},
				{
					minChars: Configuration.get('user.nameMinChars'),
				},
			),
			email: this.validateEmail(this.getMessage('invalid_email')),
			password: this.validatePassword(
				{
					invalid_password: this.getMessage('invalid_password'),
					password_min: this.getMessage('password_min'),
					password_condition_capital_letter: this.getMessage(
						'password_condition_capital_letter',
					),
					password_condition_number: this.getMessage(
						'password_condition_number',
					),
					password_condition_special_character: this.getMessage(
						'password_condition_special_character',
					),
				},
				{
					minLength: Configuration.get(
						'user.passwordMinChars',
					) as number,
				},
			),
			password_confirm: this.validateString(
				this.getMessage('password_confirm_required'),
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{
					required: false,
				},
			),
			status: this.validateEnum(
				UserStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			).default(UserStatusEnum.PENDING),
			role: this.validateEnum(
				UserRoleEnum,
				this.getMessage('invalid_role'),
				{ required: false },
			).default(UserRoleEnum.MEMBER),
			operator_type: this.validateEnum(
				UserOperatorTypeEnum,
				this.getMessage('invalid_operator_type'),
				{ required: false },
			),
		})
		.superRefine(({ password, password_confirm }, ctx) => {
			if (password !== password_confirm) {
				ctx.addIssue({
					path: ['password_confirm'],
					message: this.getMessage('password_confirm_mismatch'),
					code: 'custom',
				});
			}
		})
		.superRefine(({ role, operator_type }, ctx) => {
			if (role === UserRoleEnum.OPERATOR && !operator_type) {
				ctx.addIssue({
					path: ['operator_type'],
					message: this.getMessage('operator_type_required'),
					code: 'custom',
				});
			}

			if (role !== UserRoleEnum.OPERATOR && operator_type) {
				ctx.addIssue({
					path: ['operator_type'],
					message: this.getMessage('operator_type_only_for_operator'),
					code: 'custom',
				});
			}
		});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { id: 'id' })),
			name: this.validateString(
				{
					invalid: this.getMessage('invalid_name'),
					min_chars: this.getMessage('name_min'),
				},
				{
					required: false,
					minChars: Configuration.get('user.nameMinChars'),
				},
			),
			email: this.validateEmail(this.getMessage('invalid_email'), {
				required: false,
			}),
			password: this.validatePassword(
				{
					invalid_password: this.getMessage('invalid_password'),
					password_min: this.getMessage('password_min'),
					password_condition_capital_letter: this.getMessage(
						'password_condition_capital_letter',
					),
					password_condition_number: this.getMessage(
						'password_condition_number',
					),
					password_condition_special_character: this.getMessage(
						'password_condition_special_character',
					),
				},
				{
					required: false,
					minLength: Configuration.get(
						'user.passwordMinChars',
					) as number,
				},
			),
			password_confirm: this.validateString(
				this.getMessage('password_confirm_required'),
				{ required: false },
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{
					required: false,
				},
			),
			status: this.validateEnum(
				UserStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			role: this.validateEnum(
				UserRoleEnum,
				this.getMessage('invalid_role'),
				{ required: false },
			),
			operator_type: this.validateEnum(
				UserOperatorTypeEnum,
				this.getMessage('invalid_operator_type'),
				{ required: false },
			),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		})
		.superRefine(({ password, password_confirm }, ctx) => {
			if (password !== password_confirm) {
				ctx.addIssue({
					path: ['password_confirm'],
					message: this.getMessage('password_confirm_mismatch'),
					code: 'custom',
				});
			}
		})
		.superRefine(({ role, operator_type }, ctx) => {
			// If the role is being set to OPERATOR, operator_type must be provided
			if (
				role === UserRoleEnum.OPERATOR &&
				(operator_type === null || operator_type === undefined)
			) {
				ctx.addIssue({
					path: ['operator_type'],
					message: this.getMessage('operator_type_required'),
					code: 'custom',
				});
			}

			// If the role is being set to something other than OPERATOR, operator_type must be null
			if (
				role &&
				role !== UserRoleEnum.OPERATOR &&
				operator_type !== null &&
				operator_type !== undefined
			) {
				ctx.addIssue({
					path: ['operator_type'],
					message: this.getMessage('operator_type_only_for_operator'),
					code: 'custom',
				});
			}
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
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			status: this.validateEnum(
				UserStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			role: this.validateEnum(
				UserRoleEnum,
				this.getMessage('invalid_role'),
				{ required: false },
			),
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

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			UserStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}

export const userValidator = new UserValidator('user');
