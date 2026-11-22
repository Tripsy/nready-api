import { NotAllowedError } from '@/exceptions';
import UserEntity, { type UserOperatorType } from '@/features/user/user.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';
import type { AuthContext } from '@/shared/types/express';
import { type UserRole, UserRoleEnum } from '@/shared/types/user-role.type';

type UserRoleFields = {
	role?: UserRole;
	operator_type?: UserOperatorType | null;
};

export class UserPolicy extends PolicyAbstract {
	constructor() {
		const entity = UserEntity.NAME;

		super(entity);
	}

	/**
	 * Refuses a non-admin caller giving a user a role or operator type it does not already hold.
	 * A role is what the dashboard's access hangs off, so assigning one stays with admins even
	 * for an operator holding `user.create` / `user.update` - otherwise that operator could
	 * promote anyone, themselves included.
	 *
	 * Compared against `current` rather than refused on presence: the dashboard form sends both
	 * fields on every save, so an operator editing a name sends the unchanged role back. On a
	 * create `current` is the validator's default - a plain member.
	 */
	public canAssignRole(
		auth: AuthContext,
		data: UserRoleFields,
		current: Required<UserRoleFields> = {
			role: UserRoleEnum.MEMBER,
			operator_type: null,
		},
	): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		const changesRole =
			data.role !== undefined && data.role !== current.role;
		const changesOperatorType =
			data.operator_type !== undefined &&
			(data.operator_type ?? null) !== (current.operator_type ?? null);

		if (changesRole || changesOperatorType) {
			throw new NotAllowedError();
		}
	}

	/**
	 * Refuses a non-admin caller acting on any account but a member's - an admin's or another
	 * operator's, the caller's own row included. Holding `user.update` would otherwise let an
	 * operator reset a staff account's email or password and sign in as them, and `user.delete` /
	 * `user.update` would let them lock staff out. An operator's own account is edited through
	 * `/account/me`, not here. Reading a staff account stays with `canRead` / `canFind` - this
	 * gates writes only.
	 *
	 * Called after the `canX` check, on the stored row: the role a request carries is not
	 * evidence of who the target is.
	 */
	public canManageTarget(
		auth: AuthContext,
		target: Pick<UserEntity, 'role'>,
	): void {
		this.requiredAuth(auth);

		if (this.isAdmin(auth)) {
			return;
		}

		if (target.role !== UserRoleEnum.MEMBER) {
			throw new NotAllowedError();
		}
	}
}

export const userPolicy = new UserPolicy();
