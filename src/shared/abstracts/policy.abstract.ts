import { NotAllowedError, UnauthorizedError } from '@/exceptions';
import { toKebabCase } from '@/helpers/string.helper';
import type { EntityId } from '@/shared/types/entity-id.type';
import type {
	AuthContext,
	AuthContextPermissions,
} from '@/shared/types/express';
import { UserRoleEnum } from '@/shared/types/user-role.type';

class PolicyAbstract {
	constructor(readonly entity: string) {
		this.entity = toKebabCase(entity, {
			preserveCase: false,
			preserveUnderscores: false,
		});
	}

	public getId(auth: AuthContext): EntityId | undefined {
		return auth?.id ?? undefined;
	}

	public getRole(auth: AuthContext): string {
		return auth?.role || 'visitor';
	}

	public getPermissions(auth: AuthContext): AuthContextPermissions {
		return auth?.permissions || {};
	}

	public isAuthenticated(auth: AuthContext): boolean {
		return !!this.getId(auth);
	}

	public isAdmin(auth: AuthContext): boolean {
		return this.getRole(auth) === UserRoleEnum.ADMIN;
	}

	/**
	 * Returns `true` if is operator and owns the permission
	 *
	 * @param auth
	 * @param entity
	 * @param operation
	 */
	public hasPermission(
		auth: AuthContext,
		entity: string,
		operation: string,
	): boolean {
		return (
			this.getPermissions(auth)?.[entity]?.includes(operation) || false
		);
	}

	public requiredAuth(auth: AuthContext): void {
		if (!this.isAuthenticated(auth)) {
			throw new UnauthorizedError();
		}
	}

	/**
	 * The signed-in user's id, or 401 for a visitor - for a caller that acts on the user's own
	 * rows and has nothing to do without one.
	 */
	public requireId(auth: AuthContext): EntityId {
		const id = this.getId(auth);

		if (!id) {
			throw new UnauthorizedError();
		}

		return id;
	}

	public notAuth(auth: AuthContext): void {
		if (this.isAuthenticated(auth)) {
			throw new NotAllowedError();
		}
	}

	/**
	 * Returns `true` if the user is admin or has the `delete` permission on the selected entity.
	 * This method is used to allow permission `view` of soft deleted resources
	 */
	public allowDeleted(auth: AuthContext): boolean {
		return (
			this.isAdmin(auth) ||
			this.hasPermission(auth, this.entity, 'delete')
		);
	}

	public canCreate(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (!this.hasPermission(auth, this.entity, 'create')) {
			throw new NotAllowedError();
		}
	}

	public canRead(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (!this.hasPermission(auth, this.entity, 'read')) {
			throw new NotAllowedError();
		}
	}

	public canUpdate(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (!this.hasPermission(auth, this.entity, 'update')) {
			throw new NotAllowedError();
		}
	}

	public canDelete(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (!this.hasPermission(auth, this.entity, 'delete')) {
			throw new NotAllowedError();
		}
	}

	/**
	 * Restore action is the same as delete
	 *
	 * @param auth
	 */
	public canRestore(auth: AuthContext): void {
		this.canDelete(auth);
	}

	public canFind(auth: AuthContext): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (!this.hasPermission(auth, this.entity, 'find')) {
			throw new NotAllowedError();
		}
	}
}

export default PolicyAbstract;
