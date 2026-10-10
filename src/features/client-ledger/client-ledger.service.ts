import type { EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import type { LedgerMovement } from '@/features/cash-flow/cash-flow.hooks';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { OperationalRecordTypeEnum } from '@/features/cash-flow/operational-record.entity';
import ClientLedgerEntity, {
	ClientLedgerEntryTypeEnum,
} from '@/features/client-ledger/client-ledger.entity';
import { getClientLedgerRepository } from '@/features/client-ledger/client-ledger.repository';
import type { ClientLedgerValidator } from '@/features/client-ledger/client-ledger.validator';
import { roundMoney } from '@/helpers/shop.helper';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/** The money that moved with a client in one currency. */
export type ClientLedgerBalance = {
	currency: string;
	received: number; // Every payment captured from the client
	refunded: number; // Every refund paid back to them
	net: number; // received - refunded
	net_base: number; // `net` in the deployment base currency, at each entry's own rate
};

export class ClientLedgerService {
	constructor(
		private repository: ReturnType<typeof getClientLedgerRepository>,
	) {}

	/**
	 * @description Used through `cash-flow.hooks.ts` by `cashFlowService` when a movement
	 * completes - inside that transaction - and by `reconcile`
	 *
	 * Books money that moved with a client: a completed movement filed under one (a refund names
	 * its parent's client). Money in is positive, money out negative, gross - `cash_flow.amount` is
	 * net and scaled, and the virtual `gross_amount` is absent from a row loaded with an explicit
	 * column list.
	 *
	 * Nothing is written for a movement not completed, one that is not a client's (a vendor
	 * payment), or one whose gross rounds to 0.00 - an entry is money that moved. `ON CONFLICT DO
	 * NOTHING` on the movement: a repeated call - the reconcile cron catching up - is a no-op rather
	 * than a doubled entry.
	 */
	public async recordCashFlow(
		cashFlow: LedgerMovement,
		manager: EntityManager = dataSource.manager,
	): Promise<void> {
		if (cashFlow.status !== CashFlowStatusEnum.COMPLETED) {
			return;
		}

		const gross = toGrossAmount(
			Number(cashFlow.amount),
			Number(cashFlow.vat_rate),
		);

		if (gross === 0) {
			return;
		}

		const clientId = await cashFlowService.findClientId(cashFlow, manager);

		if (!clientId) {
			return;
		}

		const isIn = cashFlow.direction === CashFlowDirectionEnum.IN;
		const amount = isIn ? gross : -gross;

		await manager
			.createQueryBuilder()
			.insert()
			.into(ClientLedgerEntity)
			.values({
				client_id: clientId,
				entry_type: isIn
					? ClientLedgerEntryTypeEnum.PAYMENT
					: ClientLedgerEntryTypeEnum.REFUND,
				cash_flow_id: cashFlow.id,
				currency: cashFlow.currency,
				amount: amount,
				exchange_rate: Number(cashFlow.exchange_rate),
				amount_base: roundMoney(
					amount * Number(cashFlow.exchange_rate),
				),
				occurred_at: cashFlow.updated_at ?? new Date(),
			})
			.orIgnore()
			.execute();
	}

	/**
	 * @description Used in `balance` method from controller
	 *
	 * One row per currency the client has ever dealt in. Never one figure across currencies:
	 * `net_base` is offered for that, at the rate each entry froze, and is a reporting figure.
	 *
	 * Money that changed hands, not a debt: nothing here says what the client owes, only what they
	 * paid and what was paid back to them.
	 */
	public async getBalance(clientId: number): Promise<ClientLedgerBalance[]> {
		const rows = await this.repository
			.createQueryBuilder('client_ledger')
			.select('client_ledger.currency', 'currency')
			.addSelect(
				'COALESCE(SUM(CASE WHEN client_ledger.amount > 0 THEN client_ledger.amount ELSE 0 END), 0)',
				'received',
			)
			.addSelect(
				'COALESCE(SUM(CASE WHEN client_ledger.amount < 0 THEN -client_ledger.amount ELSE 0 END), 0)',
				'refunded',
			)
			.addSelect('COALESCE(SUM(client_ledger.amount), 0)', 'net')
			.addSelect(
				'COALESCE(SUM(client_ledger.amount_base), 0)',
				'net_base',
			)
			.where('client_ledger.client_id = :client_id', {
				client_id: clientId,
			})
			.groupBy('client_ledger.currency')
			.orderBy('client_ledger.currency')
			.getRawMany<{
				currency: string;
				received: string;
				refunded: string;
				net: string;
				net_base: string;
			}>();

		return rows.map((row) => ({
			currency: row.currency,
			received: roundMoney(Number(row.received)),
			refunded: roundMoney(Number(row.refunded)),
			net: roundMoney(Number(row.net)),
			net_base: roundMoney(Number(row.net_base)),
		}));
	}

	/** @description Used in `find` method from controller */
	public findByFilter(data: ValidatorOutput<ClientLedgerValidator, 'find'>) {
		return this.repository
			.createQuery()
			.filterBy('client_id', data.filter.client_id)
			.filterBy('entry_type', data.filter.entry_type)
			.filterBy('currency', data.filter.currency)
			.filterBy('cash_flow_id', data.filter.cash_flow_id)
			.filterByRange(
				'occurred_at',
				data.filter.occurred_at_start,
				data.filter.occurred_at_end,
			)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}

	/**
	 * @description Used in `client-ledger-reconcile.cron.ts` and the demo seed
	 *
	 * Books every completed client movement the table does not hold yet. A movement is booked in
	 * the transaction that completes it, so one is missing only when it was completed without this
	 * feature installed, or written straight to the table - a seed. A refund is filed under its
	 * parent's client, so both ends are looked at.
	 *
	 * Batched: every write is idempotent and a backlog clears over consecutive runs. A movement
	 * whose gross rounds to 0.00 is never booked, so it is left out here rather than found missing
	 * on every run.
	 *
	 * Takes a manager so the demo seed can run it inside its own transaction.
	 */
	public async reconcile(
		limit: number = 500,
		manager: EntityManager = dataSource.manager,
	): Promise<{ cash_flows: number }> {
		const cashFlows = await manager.query<{ id: number }[]>(
			`
				SELECT cash_flow.id FROM cash_flow
				WHERE cash_flow.deleted_at IS NULL
					AND cash_flow.status = $1
					AND cash_flow.amount * (1 + cash_flow.vat_rate / 100) >= $4
					AND EXISTS (
						SELECT 1 FROM operational_record
						WHERE operational_record.deleted_at IS NULL
							AND operational_record.operational_record_type = $2
							AND operational_record.cash_flow_id IN (cash_flow.id, cash_flow.parent_id)
					)
					AND NOT EXISTS (
						SELECT 1 FROM client_ledger
						WHERE client_ledger.cash_flow_id = cash_flow.id
					)
				ORDER BY cash_flow.id
				LIMIT $3
			`,
			[
				CashFlowStatusEnum.COMPLETED,
				OperationalRecordTypeEnum.CLIENT,
				limit,
				0.005 * 10 ** AMOUNT_DECIMALS,
			],
		);

		const cashFlowRepository = manager.getRepository(CashFlowEntity);

		for (const row of cashFlows) {
			await this.recordCashFlow(
				await cashFlowRepository.findOneByOrFail({ id: row.id }),
				manager,
			);
		}

		return { cash_flows: cashFlows.length };
	}
}

export const clientLedgerService = new ClientLedgerService(
	getClientLedgerRepository(),
);
