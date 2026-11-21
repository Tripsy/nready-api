import { expect } from '@jest/globals';
import { NotAllowedError, UnauthorizedError } from '@/exceptions';
import { ApiDocsPolicy } from '@/features/api-docs/api-docs.policy';
import type { AuthContext } from '@/shared/types/express';
import type { UserRole } from '@/shared/types/user-role.type';
import { mockId } from '@/tests/mocks/uuid.mock';

function buildAuth(
	role: UserRole,
	permissions: AuthContext['permissions'] = {},
): AuthContext {
	return {
		id: mockId(5),
		email: 'user@demo.test',
		name: 'User',
		language: 'en',
		role,
		operator_type: null,
		permissions,
		has_password: true,
		activeToken: 'ident',
	};
}

describe('ApiDocsPolicy.canView', () => {
	const policy = new ApiDocsPolicy();

	it('lets an admin through', () => {
		expect(() => policy.canView(buildAuth('admin'))).not.toThrow();
	});

	it('refuses a visitor with 401', () => {
		expect(() =>
			policy.canView(undefined as unknown as AuthContext),
		).toThrow(UnauthorizedError);
	});

	it.each<UserRole>(['operator', 'member'])('refuses a %s', (role) => {
		expect(() =>
			policy.canView(buildAuth(role, { 'api-docs': ['read', 'find'] })),
		).toThrow(NotAllowedError);
	});
});
