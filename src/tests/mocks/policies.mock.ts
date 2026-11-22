import { jest } from '@jest/globals';
import type PolicyAbstract from '@/shared/abstracts/policy.abstract';

export function notAuthenticatedSpy(policy: PolicyAbstract) {
	jest.spyOn(policy, 'isAuthenticated').mockReturnValue(false);
}

export function isAuthenticatedSpy(policy: PolicyAbstract) {
	jest.spyOn(policy, 'isAuthenticated').mockReturnValue(true);
}

export function notAuthorizedSpy(policy: PolicyAbstract) {
	jest.spyOn(policy, 'isAuthenticated').mockReturnValue(true);
	jest.spyOn(policy, 'isAdmin').mockReturnValue(false);
	jest.spyOn(policy, 'hasPermission').mockReturnValue(false);
}

export function authorizedSpy(policy: PolicyAbstract) {
	jest.spyOn(policy, 'isAuthenticated').mockReturnValue(true);
	jest.spyOn(policy, 'isAdmin').mockReturnValue(false);
	jest.spyOn(policy, 'hasPermission').mockReturnValue(true);
}

export function adminSpy(policy: PolicyAbstract) {
	jest.spyOn(policy, 'isAuthenticated').mockReturnValue(true);
	jest.spyOn(policy, 'isAdmin').mockReturnValue(true);
}
