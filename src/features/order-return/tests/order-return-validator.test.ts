import { jest } from '@jest/globals';
import { orderReturnInputPayloads } from '@/features/order-return/order-return.mock';
import { OrderReturnValidator } from '@/features/order-return/order-return.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';

beforeEach(() => {
	jest.restoreAllMocks();
});

const orderReturnValidator = new OrderReturnValidator('order-return');

type ValidatorMethod = keyof Pick<
	typeof orderReturnValidator,
	'create' | 'update' | 'approve' | 'statusUpdate' | 'find' | 'publicCreate'
>;

const listSchemas: ValidatorMethod[] = [
	'create',
	'update',
	'approve',
	'statusUpdate',
	'find',
	'publicCreate',
];

describe('OrderReturnValidator', () => {
	listSchemas.forEach((name) => {
		it(`${name}() accepts valid payload`, () => {
			const validated = orderReturnValidator[name].safeParse(
				orderReturnInputPayloads[name],
			);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	it('create() refuses no lines', () => {
		const validated = orderReturnValidator.create.safeParse({
			...orderReturnInputPayloads.create,
			lines: [],
		});

		expect(validated.success).toBe(false);
	});

	// One row per variant - the unique index would refuse the second
	it('create() refuses the same variant twice', () => {
		const validated = orderReturnValidator.create.safeParse({
			...orderReturnInputPayloads.create,
			lines: [
				{ variant_id: 27, quantity: 1 },
				{ variant_id: 27, quantity: 2 },
			],
		});

		expect(validated.success).toBe(false);
	});

	it('create() refuses a zero quantity', () => {
		const validated = orderReturnValidator.create.safeParse({
			...orderReturnInputPayloads.create,
			lines: [{ variant_id: 27, quantity: 0 }],
		});

		expect(validated.success).toBe(false);
	});

	it('update() refuses a payload carrying only the id', () => {
		const validated = orderReturnValidator.update.safeParse({ id: 7 });

		expect(validated.success).toBe(false);
	});

	it('update() accepts refund_shipping alone', () => {
		const validated = orderReturnValidator.update.safeParse({
			id: 7,
			refund_shipping: false,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
			expect(validated.data?.refund_shipping).toBe(false);
		}, validated);
	});

	it('approve() leaves refund_shipping undefined when absent', () => {
		const validated = orderReturnValidator.approve.safeParse({ id: 7 });

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
			expect(validated.data?.refund_shipping).toBeUndefined();
		}, validated);
	});

	it('approve() refuses a price without its VAT rate', () => {
		const validated = orderReturnValidator.approve.safeParse({
			id: 7,
			price: 20,
		});

		expect(validated.success).toBe(false);
	});

	it('approve() accepts a price stated with its VAT rate', () => {
		const validated = orderReturnValidator.approve.safeParse({
			id: 7,
			price: 20,
			vat_rate: 21,
		});

		expect(validated.success).toBe(true);
	});

	// `approved` and `received` have their own way in
	it('statusUpdate() refuses a status the route does not take', () => {
		const validated = orderReturnValidator.statusUpdate.safeParse({
			id: 7,
			status: 'approved',
		});

		expect(validated.success).toBe(false);
	});
});
