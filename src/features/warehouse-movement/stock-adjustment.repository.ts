import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import StockAdjustmentEntity from '@/features/warehouse-movement/stock-adjustment.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

/**
 * Reads over manual stock changes. **Never removes a row** - an adjustment gone would leave its
 * movements on the ledger with nothing to explain them. Undoing one is `reverse`, which posts the
 * opposing movements and keeps the row.
 */
export class StockAdjustmentQuery extends RepositoryAbstract<StockAdjustmentEntity> {
	constructor(repository: Repository<StockAdjustmentEntity>) {
		super(repository, StockAdjustmentEntity.NAME);
	}

	override async delete(): Promise<number> {
		throw new CustomError(
			500,
			lang('warehouse-movement.error.adjustment_append_only'),
		);
	}

	override async restore(): Promise<number> {
		throw new CustomError(
			500,
			lang('warehouse-movement.error.adjustment_append_only'),
		);
	}
}

export const getStockAdjustmentRepository = () =>
	dataSource.getRepository(StockAdjustmentEntity).extend({
		createQuery() {
			return new StockAdjustmentQuery(this);
		},
	});
