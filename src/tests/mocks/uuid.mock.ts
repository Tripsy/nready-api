/**
 * A fixed uuid for fixtures.
 *
 * Kept apart from `helpers.mock.ts` because that file imports `@jest/globals`, a
 * devDependency. `<feature>.docs.ts` files import `<feature>.mock.ts` for their samples and
 * the production build follows that import graph, so a mock a docs file reaches must pull in
 * nothing that only exists in development - the documentation loader treats a failed import
 * as an undocumented feature and skips it without a word.
 */
export function mockUuid(): string {
	return '123e4567-e89b-12d3-a456-426614174000';
}

/**
 * A fixture id: the same `n` always gives the same valid UUID v7-shaped id, and a larger `n`
 * sorts later, as a newer row's id would. `n` is written in decimal into the last group, so
 * `mockId(12)` reads as `…-000000000012` in a failure message.
 */
export function mockId(n: number): string {
	return `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}
