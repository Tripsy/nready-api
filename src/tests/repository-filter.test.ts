import { expect, jest } from '@jest/globals';
import type { Brackets, Repository } from 'typeorm';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import { ShippingQuery } from '@/features/shipping/shipping.repository';

/**
 * The conditions `RepositoryAbstract` hands TypeORM. A list has to go through the `(:...key)`
 * spread: bound whole it reaches Postgres as `IN $1`, a syntax error that only shows once the query
 * runs - and in a hook handler, which logs and swallows it, not even then.
 */
function buildQuery() {
	const builder = {
		andWhere:
			jest.fn<(condition: string, parameters?: object) => unknown>(),
	};
	builder.andWhere.mockReturnValue(builder);

	const repository = {
		createQueryBuilder: jest.fn(() => builder),
	} as unknown as Repository<ShippingEntity>;

	return { query: new ShippingQuery(repository), builder };
}

describe('RepositoryAbstract - list operators', () => {
	it.each(['IN', 'NOT IN'] as const)(
		'filterBy() spreads the list for %s',
		(operator) => {
			const { query, builder } = buildQuery();

			query.filterBy('status', ['failed', 'canceled'], operator);

			expect(builder.andWhere).toHaveBeenCalledWith(
				`shipping.status ${operator} (:...status)`,
				{ status: ['failed', 'canceled'] },
			);
		},
	);

	it('filterAny() takes a list for NOT IN', () => {
		const { query, builder } = buildQuery();

		query.filterAny([
			{
				column: 'status',
				value: ['failed', 'canceled'],
				operator: 'NOT IN',
			},
		]);

		// The conditions are OR-ed inside a `Brackets`, written when TypeORM runs its factory
		const [brackets] = builder.andWhere.mock.calls[0] as unknown as [
			Brackets,
		];
		const inner = {
			where: jest.fn<
				(condition: string, parameters?: object) => unknown
			>(),
		};

		brackets.whereFactory(inner as never);

		expect(inner.where).toHaveBeenCalledWith(
			'shipping.status NOT IN (:...status)',
			{ status: ['failed', 'canceled'] },
		);
	});

	it('filterBy() refuses a list for a scalar operator', () => {
		const { query } = buildQuery();

		expect(() =>
			query.filterBy(
				'status',
				['failed'] as unknown as string,
				'=' as const,
			),
		).toThrow();
	});
});
