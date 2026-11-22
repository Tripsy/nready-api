import { expect, jest } from '@jest/globals';
import dataSource from '@/config/data-source.config';
import { ArticleVisibilityEnum } from '@/features/article/article.entity';
import { getArticleEntityMock } from '@/features/article/article.mock';
import type { ArticleAccessTarget } from '@/features/article/article-access.policy';
import ArticleVisibilityRuleRepository, {
	type ArticleVisibilityRuleFields,
} from '@/features/article/article-visibility-rule.repository';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { AuthContext } from '@/shared/types/express';
import { mockId } from '@/tests/mocks/uuid.mock';

/*
 * `comparePassword` is a module-level function, not a method on an injected singleton, so it
 * cannot be reached with `jest.spyOn` under the ESM preset - the mock has to be registered
 * before the subject is imported (see testing.md §2.2).
 */
const comparePassword =
	jest.fn<(password: string, hashed: string) => Promise<boolean>>();

jest.unstable_mockModule('@/helpers/security.helper', () => ({
	comparePassword,
	encryptPassword: jest.fn(),
}));

const { ArticleAccessPolicy } = await import(
	'@/features/article/article-access.policy'
);

const policy = new ArticleAccessPolicy();

function restricted(): ArticleAccessTarget {
	return {
		id: getArticleEntityMock().id,
		visibility: ArticleVisibilityEnum.RESTRICTED,
	};
}

function auth(id: EntityId | null): AuthContext {
	return { id } as AuthContext;
}

function rule(
	overrides: Partial<ArticleVisibilityRuleFields> = {},
): ArticleVisibilityRuleFields {
	return {
		requires_auth: false,
		requires_subscription: false,
		allowed_countries: null,
		is_listed: true,
		has_password: false,
		...overrides,
	};
}

/** Only the subscription check still reaches the database directly. */
function mockSubscriptionCount(count: number) {
	jest.spyOn(dataSource, 'getRepository').mockReturnValue({
		count: jest.fn<() => Promise<number>>().mockResolvedValue(count),
	} as never);
}

describe('ArticleAccessPolicy', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it('allows a public article without consulting the rule', async () => {
		await expect(
			policy.assertAccess(
				{ id: mockId(1), visibility: ArticleVisibilityEnum.PUBLIC },
				auth(null),
				{},
				null,
			),
		).resolves.toBeUndefined();
	});

	it('denies a restricted article whose rule is missing', async () => {
		// Fails closed: no rule to evaluate is read as "restricted", never as "public"
		await expect(
			policy.assertAccess(restricted(), auth(mockId(1)), {}, null),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('denies a visitor when the rule requires auth', async () => {
		await expect(
			policy.assertAccess(
				restricted(),
				auth(null),
				{},
				rule({ requires_auth: true }),
			),
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it('allows a signed-in reader when the rule only requires auth', async () => {
		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{},
				rule({ requires_auth: true }),
			),
		).resolves.toBeUndefined();
	});

	it('denies when the country cannot be determined', async () => {
		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{},
				rule({ allowed_countries: ['RO'] }),
			),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('denies a country outside the allow list', async () => {
		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{ country: 'DE' },
				rule({ allowed_countries: ['RO'] }),
			),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('allows a country on the allow list', async () => {
		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{ country: 'RO' },
				rule({ allowed_countries: ['RO'] }),
			),
		).resolves.toBeUndefined();
	});

	it('denies a reader with no active subscription', async () => {
		mockSubscriptionCount(0);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{},
				rule({ requires_subscription: true }),
			),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('allows a reader holding an active subscription', async () => {
		mockSubscriptionCount(1);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{},
				rule({ requires_subscription: true }),
			),
		).resolves.toBeUndefined();
	});

	it('denies a missing password without reading the hash', async () => {
		// The point of `has_password`: a request supplying nothing is rejected before the
		// credential is ever loaded
		const findPassword = jest.spyOn(
			ArticleVisibilityRuleRepository,
			'findPassword',
		);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{},
				rule({ has_password: true }),
			),
		).rejects.toMatchObject({ statusCode: 403 });

		expect(findPassword).not.toHaveBeenCalled();
	});

	it('denies a wrong password', async () => {
		jest.spyOn(
			ArticleVisibilityRuleRepository,
			'findPassword',
		).mockResolvedValue('hashed');

		comparePassword.mockResolvedValue(false);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{ password: 'guess' },
				rule({ has_password: true }),
			),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('denies when the stored hash has gone missing', async () => {
		jest.spyOn(
			ArticleVisibilityRuleRepository,
			'findPassword',
		).mockResolvedValue(null);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{ password: 'guess' },
				rule({ has_password: true }),
			),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('allows a correct password', async () => {
		jest.spyOn(
			ArticleVisibilityRuleRepository,
			'findPassword',
		).mockResolvedValue('hashed');

		comparePassword.mockResolvedValue(true);

		await expect(
			policy.assertAccess(
				restricted(),
				auth(mockId(7)),
				{ password: 'correct' },
				rule({ has_password: true }),
			),
		).resolves.toBeUndefined();
	});
});
