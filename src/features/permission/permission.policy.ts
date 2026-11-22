import { NotAllowedError } from '@/exceptions';
import PermissionEntity from '@/features/permission/permission.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';
import type { AuthContext } from '@/shared/types/express';

export class PermissionPolicy extends PolicyAbstract {
	constructor() {
		const entity = PermissionEntity.NAME;

		super(entity);
	}

	/**
	 * Granting, revoking or restoring a user's permission - admins only, whatever `permission.*`
	 * the caller holds. An operator able to grant could hand themselves every operation on
	 * every entity, so the `create` / `delete` permissions on this entity do not reach grants;
	 * they still gate the permission catalog itself, and `find` still lists a user's grants.
	 */
	public canGrant(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (!this.isAdmin(auth)) {
			throw new NotAllowedError();
		}
	}
}

export const permissionPolicy = new PermissionPolicy();
