import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import WarehouseMovementEntity from '@/features/warehouse-movement/warehouse-movement.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

/**
 * Reads over the stock ledger. **Never removes a row.**
 *
 * The entity has no `deleted_at`, so `RepositoryAbstract.delete` would fall through to a hard
 * delete - and a ledger row gone is a balance that no longer explains itself. Both terminals are
 * overridden to refuse; a mistake is corrected by posting a reversing row.
 */
export class WarehouseMovementQuery extends RepositoryAbstract<WarehouseMovementEntity> {
	constructor(repository: Repository<WarehouseMovementEntity>) {
		super(repository, WarehouseMovementEntity.NAME);
	}

	override async delete(): Promise<number> {
		throw new CustomError(
			500,
			lang('warehouse-movement.error.append_only'),
		);
	}

	override async restore(): Promise<number> {
		throw new CustomError(
			500,
			lang('warehouse-movement.error.append_only'),
		);
	}
}

export const getWarehouseMovementRepository = () =>
	dataSource.getRepository(WarehouseMovementEntity).extend({
		createQuery() {
			return new WarehouseMovementQuery(this);
		},
	});
