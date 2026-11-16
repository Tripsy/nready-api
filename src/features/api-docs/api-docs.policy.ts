import { NotAllowedError } from '@/exceptions';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';
import type { AuthContext } from '@/shared/types/express';

/**
 * The generated API reference is for platform administrators only. It holds no data - request
 * shapes and the sample payloads the docs files declare - but it maps every endpoint, its
 * input rules and which ones skip a token, which is more than any other role needs.
 *
 * There is no entity behind it, so no grant can reach it: `canView` checks the role alone,
 * and an operator holding every permission is still refused.
 */
export class ApiDocsPolicy extends PolicyAbstract {
	constructor() {
		super('api-docs');
	}

	public canView(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (!this.isAdmin(auth)) {
			throw new NotAllowedError();
		}
	}
}

export const apiDocsPolicy = new ApiDocsPolicy();
