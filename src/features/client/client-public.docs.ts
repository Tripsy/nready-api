import { ClientTypeEnum } from '@/features/client/client.entity';
import {
	clientInputPayloads,
	getClientEntityMock,
} from '@/features/client/client.mock';
import type { clientPublicController } from '@/features/client/client-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

const entitySample = (() => {
	const { deleted_at, person_identification_number, ...rest } =
		getClientEntityMock() as unknown as Record<string, unknown>;

	return rest;
})();

/**
 * The storefront half: the bill-to choices at checkout. Every row is the caller's own - the one id
 * in a path is resolved within the account - and there is no permission to hold.
 */
export const docs: Record<
	keyof typeof clientPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: "The caller's own clients",
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Every client linked to the account, newest first',
			dataSample: { entries: [entitySample] },
		},
		withAuthErrors: true,
		request: {
			notes: 'Requires an account. Unpaginated - an account holds a handful of clients. These are the only clients `POST /public/cart/checkout` accepts as `client_id`; an empty list means the checkout flow has to create one first',
		},
	}),

	create: helperApiInputDocumentation({
		description: 'Add a client to bill orders to',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Client created and linked to the account',
			dataSample: entitySample,
			withMessage: true,
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: `Requires an account, which the client is linked to - an owner is never taken from the body. client_type picks the branch: ${ClientTypeEnum.COMPANY} takes company_name, company_cui and company_reg_com, ${ClientTypeEnum.PERSON} takes person_name. person_identification_number is refused here. A company already on file under the same name, CUI or registration number answers 409, including one entered from the back office - linking that one to the account is an operator's action`,
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
				iban: {
					type: 'string',
					required: false,
					condition: 'checked for IBAN format',
				},
				bank_name: { type: 'string', required: false },
				contact_name: { type: 'string', required: false },
				contact_email: { type: 'string', required: false },
				contact_phone: { type: 'string', required: false },
				notes: { type: 'string', required: false },
			},
			sample: clientInputPayloads.create,
		},
	}),

	update: helperApiInputDocumentation({
		description: 'Update one of your own clients',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client updated',
			dataSample: entitySample,
			withMessage: true,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Requires an account. The id must name a client linked to that account - somebody else's answers 404, exactly as a missing one does. Partial: send only what changes; client_type defaults to the stored one and picks the branch the same way create does. person_identification_number is refused here. Changing a company's name, CUI or registration number to one already on file answers 409`,
			params: {
				id: {
					type: 'number',
					required: true,
					condition: "one of the caller's own clients",
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
				iban: {
					type: 'string',
					required: false,
					condition: 'checked for IBAN format',
				},
				bank_name: { type: 'string', required: false },
				contact_name: { type: 'string', required: false },
				contact_email: { type: 'string', required: false },
				contact_phone: { type: 'string', required: false },
				notes: { type: 'string', required: false },
			},
			sample: clientInputPayloads.update,
		},
	}),
};
