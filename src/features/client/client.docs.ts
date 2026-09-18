import { Configuration } from '@/config/settings.config';
import type { clientController } from '@/features/client/client.controller';
import {
	ClientStatusEnum,
	ClientTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/client/client.entity';
import {
	clientInputPayloads,
	getClientEntityMock,
} from '@/features/client/client.mock';
import { OrderByEnum } from '@/features/client/client.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getClientEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `active -> inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

/**
 * `client_type` discriminates the body: the branch it names is the only one whose fields are
 * accepted, and sending the other branch's is an error rather than a value that is ignored.
 */
const branchNote = `client_type picks the branch: ${ClientTypeEnum.COMPANY} takes company_name, company_cui and company_reg_com, ${ClientTypeEnum.PERSON} takes person_name and person_identification_number. A field from the other branch is refused`;

const duplicateNote =
	'A company sharing a name, CUI or registration number with another, or a person sharing an identification number, answers 409 - and the check counts soft-deleted rows, so deleting a client does not free its identity';

/** The contact and banking half, identical in both branches and in both writes. */
const sharedBody = {
	iban: {
		type: 'string' as const,
		required: false,
		condition: 'checked for IBAN format',
	},
	bank_name: { type: 'string' as const, required: false },
	contact_name: { type: 'string' as const, required: false },
	contact_email: { type: 'string' as const, required: false },
	contact_phone: {
		type: 'string' as const,
		required: false,
		condition:
			'7 to 15 digits with an optional leading +; separators are ignored',
	},
	notes: { type: 'string' as const, required: false },
};

/** The account a client belongs to; one account may hold several clients, a client one account. */
const updateAccountBody = {
	user_id: {
		type: 'number' as const,
		required: true,
		condition:
			'the account the client belongs to; null unlinks it. Checkout accepts only a client linked to the caller, and a review counts as a verified purchase only through such a client',
	},
};

const identificationNumberCondition =
	'checked as a CNP, including its control digit; never returned by a read';

export const docs: Record<
	keyof typeof clientController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new client',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Client created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${branchNote}. ${duplicateNote}. A new client is created ${ClientStatusEnum.ACTIVE}, whatever the column default says`,
			body: {
				client_type: {
					type: 'enum',
					required: true,
					values: Object.values(ClientTypeEnum),
				},
				company_name: {
					type: 'string',
					required: false,
					condition: `required when client_type is ${ClientTypeEnum.COMPANY}`,
				},
				company_cui: {
					type: 'string',
					required: false,
					condition: `required when client_type is ${ClientTypeEnum.COMPANY}`,
				},
				company_reg_com: { type: 'string', required: false },
				person_name: {
					type: 'string',
					required: false,
					condition: `required when client_type is ${ClientTypeEnum.PERSON}`,
				},
				person_identification_number: {
					type: 'string',
					required: false,
					condition: identificationNumberCondition,
				},
				...sharedBody,
			},
			sample: clientInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get client details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Only the branch the client belongs to is returned - the other branch's fields are stripped, and person_identification_number is never selected. `user` carries the linked account's id, name and email, or null",
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update client',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Provide at least one body parameter besides client_type, which falls back to the stored value when omitted - so switching a client between the two branches means sending the target branch's fields with it. ${branchNote}. ${duplicateNote}. status and the linked account each have their own route`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				client_type: {
					type: 'enum',
					required: false,
					values: Object.values(ClientTypeEnum),
				},
				company_name: { type: 'string', required: false },
				company_cui: { type: 'string', required: false },
				company_reg_com: { type: 'string', required: false },
				person_name: { type: 'string', required: false },
				person_identification_number: {
					type: 'string',
					required: false,
					condition: identificationNumberCondition,
				},
				...sharedBody,
			},
			sample: clientInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete client',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore client',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get clients',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: 'id',
					direction: 'DESC',
					limit: 5,
					page: 1,
					filter: {
						term: 'acme',
						client_type: ClientTypeEnum.COMPANY,
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'create_at_start must not be after create_at_end. Ordering is by id or created_at only. Each entry carries `user` with the linked account id, name and email, or null',
			query: {
				page: {
					type: 'number',
					required: false,
					default: 1,
				},
				limit: {
					type: 'number',
					required: false,
					default: Configuration.get('filter.limit'),
				},
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
					default: OrderByEnum.ID,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.ASC,
				},
				filter: {
					id: {
						type: 'array',
						required: false,
						format: 'number[]',
						condition:
							'one id or several; a single value may be sent unwrapped',
					},
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the identity fields of the branch client_type names, or of both when it is absent, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					client_type: {
						type: 'enum',
						required: false,
						values: Object.values(ClientTypeEnum),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(ClientStatusEnum),
					},
					user_id: {
						type: 'number',
						required: false,
						condition: 'the clients linked to one account',
					},
					create_at_start: { type: 'string', required: false },
					create_at_end: { type: 'string', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: clientInputPayloads.find,
		},
	}),
	updateAccount: helperApiInputDocumentation({
		description: 'Link a client to an account, or unlink it',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client linked to account successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: 'The account is granted here rather than through update, which no longer accepts user_id. Send null to unlink. An account that does not exist answers 404',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: updateAccountBody,
			sample: clientInputPayloads.updateAccount,
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Move a client to another status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client status updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(ClientStatusEnum),
				},
			},
		},
	}),
};
