import { jest } from '@jest/globals';
import { userInputPayloads } from '@/features/user/user.mock';
import { userValidator } from '@/features/user/user.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';

beforeEach(() => {
	jest.restoreAllMocks();
});

type ValidatorMethod = keyof Pick<
	typeof userValidator,
	'create' | 'update' | 'find'
>;

const validator = 'UserValidator';
const listSchemas: ValidatorMethod[] = ['create', 'update', 'find'];

describe(validator, () => {
	listSchemas.forEach((n) => {
		it(`${n}() accepts valid payload`, () => {
			const schema = userValidator[n];
			const payload = userInputPayloads[n];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	// The UI's form sends a blank field as null - an update leaving the password unchanged
	it('update() accepts a payload with no password', () => {
		const validated = userValidator.update.safeParse({
			...userInputPayloads.update,
			password: null,
			password_confirm: null,
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
		}, validated);
	});
});
