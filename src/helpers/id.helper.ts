import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Orders two ids for `Array.prototype.sort`. A UUID v7 leads with its creation time and is
 * fixed-width lowercase hex, so plain string order is creation order. Not `localeCompare`: a
 * collation is free to reorder characters.
 */
export function compareIds(first: EntityId, second: EntityId): number {
	if (first === second) {
		return 0;
	}

	return first < second ? -1 : 1;
}
