import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import OperationalRecordEntity, {
	type OperationalRecordType,
} from '@/features/cash-flow/operational-record.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class CashFlowQuery extends RepositoryAbstract<CashFlowEntity> {
	constructor(repository: Repository<CashFlowEntity>) {
		super(repository, CashFlowEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'notes',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'external_reference',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getCashFlowRepository = () =>
	dataSource.getRepository(CashFlowEntity).extend({
		createQuery() {
			return new CashFlowQuery(this);
		},

		async setupOperationalRecord(
			manager: EntityManager,
			data: {
				cash_flow_id: EntityId;
				operational_record_type: OperationalRecordType;
				entity_id: EntityId | undefined;
			},
		) {
			const existingEntry = await manager
				.createQueryBuilder(OperationalRecordEntity, 'or')
				.select(['or.id', 'or.entity_id', 'or.deleted_at'])
				.where('or.cash_flow_id = :cash_flow_id', {
					cash_flow_id: data.cash_flow_id,
				})
				.andWhere(
					'or.operational_record_type = :operational_record_type',
					{ operational_record_type: data.operational_record_type },
				)
				.withDeleted()
				.getOne();

			if (existingEntry) {
				if (data.entity_id) {
					// Update existing entry
					await manager.save(OperationalRecordEntity, {
						id: existingEntry.id,
						entity_id: data.entity_id,
						deleted_at: null,
					});
				} else {
					// Soft remove existing entry
					await manager.softRemove(existingEntry);
				}
			} else {
				if (data.entity_id) {
					// Create new entry
					await manager.save(OperationalRecordEntity, {
						cash_flow_id: data.cash_flow_id,
						operational_record_type: data.operational_record_type,
						entity_id: data.entity_id,
					});
				}
			}
		},
	});
