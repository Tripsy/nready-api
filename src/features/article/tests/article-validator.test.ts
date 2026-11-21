import { jest } from '@jest/globals';
import { articleInputPayloads } from '@/features/article/article.mock';
import { ArticleValidator } from '@/features/article/article.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

beforeEach(() => {
	jest.restoreAllMocks();
});

const articleValidator = new ArticleValidator('article');

type ValidatorMethod = keyof Pick<
	typeof articleValidator,
	'create' | 'update' | 'find'
>;

const validator = 'ArticleValidator';
const listSchemas: ValidatorMethod[] = ['create', 'update', 'find'];

describe(validator, () => {
	listSchemas.forEach((n) => {
		it(`${n}() accepts valid payload`, () => {
			const schema = articleValidator[n];
			const payload = articleInputPayloads[n];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	it('create() rejects an empty contents array', () => {
		const validated = articleValidator.create.safeParse({
			...articleInputPayloads.create,
			contents: [],
		});

		expect(validated.success).toBe(false);
	});

	it('create() rejects two contents sharing a language', () => {
		const [content] = articleInputPayloads.create.contents;

		const validated = articleValidator.create.safeParse({
			...articleInputPayloads.create,
			contents: [content, { ...content, slug: 'other-slug' }],
		});

		expect(validated.success).toBe(false);
	});

	it('create() lowercases and trims the slug', () => {
		const [content] = articleInputPayloads.create.contents;

		const validated = articleValidator.create.safeParse({
			...articleInputPayloads.create,
			contents: [{ ...content, slug: '  Mixed-Case-Slug ' }],
		});

		withDebugValidated(() => {
			expect(validated.success).toBe(true);
			expect(validated.data?.contents[0].slug).toBe('mixed-case-slug');
		}, validated);
	});

	it('update() rejects a payload carrying only the id', () => {
		const validated = articleValidator.update.safeParse({ id: mockId(1) });

		expect(validated.success).toBe(false);
	});

	it('update() ignores source_mode - it is create-only', () => {
		const validated = articleValidator.update.safeParse({
			id: mockId(1),
			source_mode: 'parsed',
		});

		// Nothing updatable was supplied, so `params_at_least_one` still fires
		expect(validated.success).toBe(false);
	});

	it('create() rejects a country code that is not two letters', () => {
		const validated = articleValidator.create.safeParse({
			...articleInputPayloads.create,
			visibility_rule: { allowed_countries: ['ROU'] },
		});

		expect(validated.success).toBe(false);
	});
});
