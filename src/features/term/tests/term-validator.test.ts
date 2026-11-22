import { jest } from '@jest/globals';
import { termInputPayloads } from '@/features/term/term.mock';
import { TermValidator } from '@/features/term/term.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

beforeEach(() => {
	jest.restoreAllMocks();
});

const termValidator = new TermValidator('term');

type ValidatorMethod = keyof Pick<
	typeof termValidator,
	'create' | 'update' | 'find'
>;

const validator = 'TermValidator';
const listSchemas: ValidatorMethod[] = ['create', 'update', 'find'];

describe(validator, () => {
	listSchemas.forEach((n) => {
		it(`${n}() accepts valid payload`, () => {
			const schema = termValidator[n];
			const payload = termInputPayloads[n];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	it('create() rejects an unknown type', () => {
		const validated = termValidator.create.safeParse({
			...termInputPayloads.create,
			type: 'not-a-type',
		});

		expect(validated.success).toBe(false);
	});

	it('create() rejects contents repeating a language', () => {
		const validated = termValidator.create.safeParse({
			...termInputPayloads.create,
			contents: [
				{ language: 'en', value: 'Summer' },
				{ language: 'en', value: 'Summertime' },
			],
		});

		expect(validated.success).toBe(false);
	});

	it('create() rejects an empty contents list', () => {
		const validated = termValidator.create.safeParse({
			...termInputPayloads.create,
			contents: [],
		});

		expect(validated.success).toBe(false);
	});

	it('update() rejects a payload carrying only the id', () => {
		const validated = termValidator.update.safeParse({ id: mockId(1) });

		expect(validated.success).toBe(false);
	});
});
