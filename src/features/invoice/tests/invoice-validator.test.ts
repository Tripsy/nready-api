import { jest } from '@jest/globals';
import { invoiceInputPayloads } from '@/features/invoice/invoice.mock';
import { InvoiceValidator } from '@/features/invoice/invoice.validator';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import { withDebugValidated } from '@/tests/jest-validator.setup';

beforeEach(() => {
	jest.restoreAllMocks();
});

const invoiceValidator = new InvoiceValidator('invoice');

type ValidatorMethod = keyof Pick<
	typeof invoiceValidator,
	'create' | 'update' | 'find' | 'lineCreate' | 'paymentCreate'
>;

const validator = 'InvoiceValidator';

const listSchemas: ValidatorMethod[] = [
	'create',
	'update',
	'find',
	'lineCreate',
	'paymentCreate',
];

describe(validator, () => {
	listSchemas.forEach((name) => {
		it(`${name}() accepts valid payload`, () => {
			const schema = invoiceValidator[name];
			const payload = invoiceInputPayloads[name];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	it('create() rejects an unknown scope', () => {
		const validated = invoiceValidator.create.safeParse({
			...invoiceInputPayloads.create,
			scope: 'not-a-scope',
		});

		expect(validated.success).toBe(false);
	});

	it('update() rejects a payload carrying only the id', () => {
		const validated = invoiceValidator.update.safeParse({ id: 1 });

		expect(validated.success).toBe(false);
	});

	/*
	 * A zero-rated line and a line with no discount are both ordinary, and `validateNumber`'s
	 * `onlyPositive` is strictly greater than zero - which is why those two fields go through
	 * the validator's own non-negative schemas.
	 */
	it('lineCreate() accepts a zero VAT rate and a zero discount', () => {
		const validated = invoiceValidator.lineCreate.safeParse({
			...invoiceInputPayloads.lineCreate,
			vat_rate: 0,
			discount_reduction: 0,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
		}, validated);
	});

	it('lineCreate() rejects a negative discount', () => {
		const validated = invoiceValidator.lineCreate.safeParse({
			...invoiceInputPayloads.lineCreate,
			discount_reduction: -1,
		});

		expect(validated.success).toBe(false);
	});

	it('lineCreate() rejects a quantity of zero', () => {
		const validated = invoiceValidator.lineCreate.safeParse({
			...invoiceInputPayloads.lineCreate,
			quantity: 0,
		});

		expect(validated.success).toBe(false);
	});

	/*
	 * Only `adjustment` is on the schema: a product or shipping line names the row it was raised
	 * from, and a caller naming one by hand could point a line at somebody else's order.
	 */
	it('lineCreate() rejects a kind other than adjustment', () => {
		const validated = invoiceValidator.lineCreate.safeParse({
			...invoiceInputPayloads.lineCreate,
			kind: InvoiceLineKindEnum.PRODUCT,
		});

		expect(validated.success).toBe(false);
	});

	it('lineUpdate() rejects a payload carrying only the ids', () => {
		const validated = invoiceValidator.lineUpdate.safeParse({
			id: 1,
			line_id: 2,
		});

		expect(validated.success).toBe(false);
	});

	it('lineUpdate() accepts a single updatable field', () => {
		const validated = invoiceValidator.lineUpdate.safeParse({
			id: 1,
			line_id: 2,
			quantity: 3,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
		}, validated);
	});

	// Free text, but whole: blanks come back as `null` so the snapshot carries every key
	it('update() accepts a company buyer and fills the blanks with null', () => {
		const validated = invoiceValidator.update.safeParse({
			id: 1,
			billing_details: {
				type: 'company',
				company_name: 'Acme SRL',
				address_country: 'Romania',
				address_city: '',
			},
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
			expect(validated.data?.billing_details).toMatchObject({
				company_name: 'Acme SRL',
				address_city: null,
				company_cui: null,
				iban: null,
			});
		}, validated);
	});

	it('update() rejects a buyer with no name or country', () => {
		const validated = invoiceValidator.update.safeParse({
			id: 1,
			billing_details: { type: 'person', person_name: '' },
		});

		expect(validated.success).toBe(false);
	});

	// `null` hands the party back to issuing, so it counts as something to update
	it('update() accepts null to clear the seller', () => {
		const validated = invoiceValidator.update.safeParse({
			id: 1,
			seller_details: null,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
		}, validated);
	});

	it('createCustom() accepts a client on its own', () => {
		const validated = invoiceValidator.createCustom.safeParse({
			client_id: 5,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
		}, validated);
	});

	it('createCustom() rejects a payload with no client', () => {
		const validated = invoiceValidator.createCustom.safeParse({});

		expect(validated.success).toBe(false);
	});

	// A custom document names no order, so it never comes through the order-backed create
	it('create() rejects the custom scope', () => {
		const validated = invoiceValidator.create.safeParse({
			order_id: 1,
			scope: 'custom',
		});

		expect(validated.success).toBe(false);
	});

	it('paymentCreate() rejects an amount of zero', () => {
		const validated = invoiceValidator.paymentCreate.safeParse({
			...invoiceInputPayloads.paymentCreate,
			amount: 0,
		});

		expect(validated.success).toBe(false);
	});

	it('paymentCreate() rejects more than two decimals on the amount', () => {
		const validated = invoiceValidator.paymentCreate.safeParse({
			...invoiceInputPayloads.paymentCreate,
			amount: 10.123,
		});

		expect(validated.success).toBe(false);
	});

	it('find() rejects an unknown order_by', () => {
		const validated = invoiceValidator.find.safeParse({
			...invoiceInputPayloads.find,
			order_by: 'total_owed',
		});

		expect(validated.success).toBe(false);
	});
});
