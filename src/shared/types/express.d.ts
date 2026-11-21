import { UserOperatorType } from '@/features/user/user.entity';
import { OutputWrapper } from '@/middleware/output-handler.middleware';
import type { EntityId } from '@/shared/types/entity-id.type';
import { UserRole } from '@/shared/types/user-role.type';

export type AuthContextPermissions = Record<string, string[]>;

export type AuthContext = {
	// Null for a visitor: no user is signed in
	id: EntityId | null;
	email: string;
	name: string;
	language: string;
	role: UserRole | 'visitor';
	operator_type: UserOperatorType | null;
	permissions: AuthContextPermissions;
	// False for a social sign-in account that has never set one.
	has_password: boolean;
	activeToken: string;
};

declare global {
	namespace Express {
		interface Locals {
			request_id: string;
			auth: AuthContext;
			output: OutputWrapper;
			language: string;
			// validated: Record<string, number | string | boolean>;
		}
	}
}
