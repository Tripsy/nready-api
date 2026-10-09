import type { DeepPartial, EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	type CashFlowCategoryType,
	CashFlowCategoryTypeEnum,
	type CashFlowDirection,
	CashFlowDirectionEnum,
	type CashFlowMethod,
	type CashFlowStatus,
	CashFlowStatusEnum,
	getExpectedCategoryType,
	getExpectedDirection,
	MUTABLE_STATUSES,
	REFUNDABLE_STATUSES,
	STATUS_TRANSITIONS,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import {
	notifyCashFlowCompleted,
	recordLedgerMovement,
	resolveOperationalRecordOrder,
} from '@/features/cash-flow/cash-flow.hooks';
import { getCashFlowRepository } from '@/features/cash-flow/cash-flow.repository';
import {
	type CashFlowValidator,
	paramsRestatingEntry,
	paramsUpdateList,
} from '@/features/cash-flow/cash-flow.validator';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import OperationalRecordEntity, {
	getOperationalRecordOptions,
	type OperationalRecordType,
	OperationalRecordTypeEnum,
	type OperationalRecordWithRelations,
} from '@/features/cash-flow/operational-record.entity';
import { getOperationalRecordRepository } from '@/features/cash-flow/operational-record.repository';
import { clientService } from '@/features/client/client.service';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';
import { exchangeRateService } from '@/features/exchange-rate/exchange-rate.service';
import { vendorService } from '@/features/vendor/vendor.service';
import {
	arrayHasValue,
	hasAtLeastOneValue,
	pickValuesFromObject,
} from '@/helpers/objects.helper';
import { roundMoney } from '@/helpers/shop.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class CashFlowService {
	constructor(private repository: ReturnType<typeof getCashFlowRepository>) {}

	// `amount` represent the value coming through request; this method returns the value to be stored in database
	public inputAmount(amount: number) {
		return Math.round(Math.abs(amount) * 10 ** AMOUNT_DECIMALS);
	}

	public checkDirection(
		category_type: CashFlowCategoryType,
		direction: CashFlowDirection,
	) {
		const expectedDirection = getExpectedDirection(category_type);

		if (expectedDirection && direction !== expectedDirection) {
			throw new BadRequestError(
				lang('cash-flow.error.direction_expected_from_category_type', {
					category_type: category_type,
					direction: expectedDirection,
				}),
			);
		}
	}

	public checkCategoryType(
		category_type: CashFlowCategoryType,
		category: CashFlowCategory,
	) {
		const expectedCategoryType = getExpectedCategoryType(category);

		if (category_type !== expectedCategoryType) {
			throw new BadRequestError(
				lang('cash-flow.error.category_type_mismatch', {
					category: category_type,
					category_type: expectedCategoryType,
				}),
			);
		}
	}

	public checkCategory(category: CashFlowCategory, parent_id?: number) {
		if (category === CashFlowCategoryEnum.REFUND && !parent_id) {
			throw new BadRequestError(
				lang('cash-flow.error.refund_parent_required'),
			);
		}
	}

	public async checkRefund(deps: {
		category: CashFlowCategory;
		inputAmount: number;
		currency: string;
		parentEntry: CashFlowEntity;
		refundedAmount: number;
	}) {
		if (deps.category !== CashFlowCategoryEnum.REFUND) {
			throw new BadRequestError(
				lang('cash-flow.validation.invalid_category'),
			);
		}

		if (!arrayHasValue(deps.parentEntry.status, REFUNDABLE_STATUSES)) {
			throw new CustomError(
				409,
				lang('cash-flow.error.invalid_refund_parent_status', {
					status: deps.parentEntry.status,
				}),
			);
		}

		if (deps.parentEntry.currency !== deps.currency) {
			throw new CustomError(
				409,
				lang('cash-flow.error.refund_parent_same_currency'),
			);
		}

		if (
			deps.parentEntry.category_type ===
			CashFlowCategoryTypeEnum.CORRECTION
		) {
			throw new CustomError(
				409,
				lang('cash-flow.error.refund_parent_invalid_category_type'),
			);
		}

		if (deps.parentEntry.amount < deps.inputAmount) {
			throw new CustomError(
				409,
				lang('cash-flow.error.refund_amount_mismatch', {
					max_amount: (deps.parentEntry.amount / 100)
						.toFixed(2)
						.toString(),
				}),
			);
		}

		if (deps.parentEntry.amount - deps.refundedAmount < deps.inputAmount) {
			throw new CustomError(
				409,
				lang('cash-flow.error.refund_amount_mismatch', {
					max_amount: (
						(deps.parentEntry.amount - deps.refundedAmount) /
						100
					)
						.toFixed(2)
						.toString(),
				}),
			);
		}
	}

	/**
	 * The rate this entry converts to the books at, frozen onto the row - see the
	 * `exchange_rate` column and `GROSS_AMOUNT_BASE_CURRENCY_EXPRESSION`, which is what sums a
	 * mixed-currency set of rows.
	 *
	 * A refund inherits the rate its parent was captured at instead of taking today's.
	 * `checkRefund` has already established that the two are the same currency, so converting
	 * the way back at a rate that has since moved would leave a residue in base currency that
	 * no payment ever produced - an FX gain is its own entry, not part of a refund.
	 */
	public async getExchangeRate(
		selectedCurrency: string,
		parentEntry?: CashFlowEntity | null,
	): Promise<number> {
		if (parentEntry) {
			return parentEntry.exchange_rate;
		}

		// Answers 1 for the deployment's own currency without a query
		const rate = await exchangeRateService.getRateAsOf(selectedCurrency);

		if (rate === null) {
			throw new BadRequestError(
				lang('cash-flow.error.exchange_rate_unavailable', {
					currency: selectedCurrency,
				}),
			);
		}

		return rate;
	}

	public async getRefundedAmountSum(parent_id: number): Promise<number> {
		const result = await this.repository
			.createQuery()
			.select(['SUM(cash_flow.amount) AS total'], false)
			.filterBy('parent_id', parent_id)
			.firstRaw();

		return result.total || 0;
	}

	public checkOperationalRecords(
		category: CashFlowCategory,
		operationalRecords: ValidatorOutput<
			CashFlowValidator,
			'create'
		>['operational_records'],
	) {
		const operationalRecordOptions = getOperationalRecordOptions(category);

		if (!operationalRecordOptions) {
			return; // Category has no operational record rules
		}

		if (operationalRecordOptions.required?.length) {
			// If there are required types but no operational_records object at all
			if (!operationalRecords) {
				throw new CustomError(
					409,
					lang(
						'cash-flow.validation.required_operational_record_type',
						{
							operational_record_type:
								operationalRecordOptions.required.join(', '),
						},
					),
				);
			}

			// Check each required type individually
			for (const requiredType of operationalRecordOptions.required) {
				if (!operationalRecords[requiredType]) {
					throw new CustomError(
						409,
						lang(
							'cash-flow.validation.required_operational_record_type',
							{
								operational_record_type: requiredType,
							},
						),
					);
				}
			}
		}
	}

	/**
	 * What an update is allowed to do to the records a movement is filed under.
	 *
	 * `create` demands every required type outright, because there is nothing on the row yet. An
	 * update submits only the types it is changing, so demanding them all again would refuse an
	 * operator attaching an order to a movement whose client has been on file since checkout.
	 *
	 * What is refused instead is the one move that cannot be read as a correction:
	 * `setupOperationalRecord` treats a type present with no id as an instruction to unlink, and
	 * unlinking a required type leaves the movement filed under nobody. A category change is not
	 * handled here - the row then has to satisfy a different set of rules from scratch, which is
	 * `checkOperationalRecords`' job.
	 */
	public checkOperationalRecordsUpdate(
		category: CashFlowCategory,
		operationalRecords: ValidatorOutput<
			CashFlowValidator,
			'update'
		>['operational_records'],
	) {
		if (!operationalRecords) {
			return;
		}

		const operationalRecordOptions = getOperationalRecordOptions(category);

		for (const requiredType of operationalRecordOptions?.required ?? []) {
			if (
				requiredType in operationalRecords &&
				!operationalRecords[requiredType]
			) {
				throw new CustomError(
					409,
					lang(
						'cash-flow.validation.required_operational_record_type',
						{
							operational_record_type: requiredType,
						},
					),
				);
			}
		}
	}

	public dropInvalidOperationalRecords(
		category: CashFlowCategory,
		operationalRecords: ValidatorOutput<
			CashFlowValidator,
			'create'
		>['operational_records'],
	): Partial<
		ValidatorOutput<CashFlowValidator, 'create'>['operational_records']
	> {
		if (!operationalRecords) {
			return operationalRecords;
		}

		const operationalRecordOptions = getOperationalRecordOptions(category);

		const allowedTypes = [
			...(operationalRecordOptions?.required ?? []),
			...(operationalRecordOptions?.optional ?? []),
		];

		return Object.fromEntries(
			Object.entries(operationalRecords).filter(([type]) =>
				allowedTypes.includes(type as OperationalRecordType),
			),
		);
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<CashFlowValidator, 'create'>,
	): Promise<CashFlowEntity> {
		return dataSource.transaction((manager) => {
			return this.createWithin(manager, data);
		});
	}

	/**
	 * @description Used by a caller that already holds a transaction - a checkout raising the
	 * payment request for the order it is writing in the same breath
	 *
	 * **Takes the caller's `EntityManager` rather than opening its own transaction**, the way
	 * `OrderService.create` and `ShippingService.createWithin` do: a payment request must not
	 * outlive a checkout that failed to write the order it was asked for.
	 *
	 * Every check `create` runs, runs here - this is where they live, and `create` is the
	 * transaction wrapper around it.
	 */
	public async createWithin(
		manager: EntityManager,
		data: ValidatorOutput<CashFlowValidator, 'create'>,
	): Promise<CashFlowEntity> {
		const inputAmount = this.inputAmount(data.amount);
		const currency = data.currency ?? resolveBaseCurrency();

		this.checkDirection(data.category_type, data.direction);
		this.checkCategoryType(data.category_type, data.category);
		this.checkCategory(data.category, data.parent_id);
		this.checkOperationalRecords(data.category, data.operational_records);

		// Held beyond the refund checks: a refund takes its rate from the entry it reverses
		let parentEntry: CashFlowEntity | null = null;

		if (data.parent_id) {
			parentEntry = await this.findById(data.parent_id, false);

			const refundedAmount = await this.getRefundedAmountSum(
				data.parent_id,
			);

			await this.checkRefund({
				category: data.category,
				inputAmount: inputAmount,
				currency: currency,
				parentEntry: parentEntry,
				refundedAmount: refundedAmount,
			});
		}

		const entry = {
			direction: data.direction,
			category_type: data.category_type,
			category: data.category,
			method: data.method,
			amount: inputAmount,
			vat_rate: data.vat_rate,
			currency: currency,
			exchange_rate: await this.getExchangeRate(currency, parentEntry),
			external_reference: data.external_reference,
			parent_id: data.parent_id,
			notes: data.notes,
		};

		/*
		 * A refund is filed under whoever its parent is filed under - the client it pays back, the
		 * order it came from. Inherited rather than stated, and outside the category map, which
		 * says what a caller may state: the refund then reads as its client's money everywhere a
		 * movement's own records are read (the ledger, allocation, the list filtered by client).
		 */
		const operationalRecords = parentEntry
			? await this.findRecordsWithin(manager, parentEntry.id)
			: this.dropInvalidOperationalRecords(
					data.category,
					data.operational_records,
				);

		const resultEntry = await manager
			.getRepository(CashFlowEntity)
			.save(entry);

		if (operationalRecords) {
			await Promise.all(
				Object.entries(operationalRecords).map(
					([operational_record_type, entity_id]) =>
						this.repository.setupOperationalRecord(manager, {
							cash_flow_id: resultEntry.id,
							operational_record_type:
								operational_record_type as OperationalRecordType,
							entity_id: entity_id,
						}),
				),
			);
		}

		return resultEntry;
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<CashFlowEntity> & { id: number },
	): Promise<CashFlowEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(CashFlowEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: CashFlowEntity,
		data: ValidatorOutput<CashFlowValidator, 'update'>,
	) {
		if (data.amount) {
			data.amount = this.inputAmount(data.amount);
		}

		/*
		 * The status gate covers what the movement *is* - its amount, category, method, currency -
		 * and not what it is filed under. A captured payment is settled money and may no longer be
		 * restated, but the order it turns out to belong to is often established afterwards: a
		 * bank transfer lands unmatched, an operator identifies it, and that link is what lets the
		 * invoice be raised from the order's own lines.
		 */
		if (
			hasAtLeastOneValue(data, paramsRestatingEntry) &&
			!arrayHasValue(entry.status, MUTABLE_STATUSES)
		) {
			throw new CustomError(
				409,
				lang('cash-flow.error.update_not_allowed'),
			);
		}

		if (data.category_type || data.direction) {
			this.checkDirection(
				data.category_type || entry.category_type,
				data.direction || entry.direction,
			);
		}

		if (data.category_type || data.category) {
			this.checkCategoryType(
				data.category_type || entry.category_type,
				data.category || entry.category,
			);
		}

		if (data.category) {
			this.checkCategory(
				data.category || entry.category,
				entry.parent_id || undefined,
			);
		}

		/*
		 * A category change makes the row answer to a different set of rules with nothing carried
		 * over, so it is checked the way a create is. Everything else is a correction to records
		 * already on file.
		 */
		if (data.operational_records) {
			if (data.category && data.category !== entry.category) {
				this.checkOperationalRecords(
					data.category,
					data.operational_records,
				);
			} else {
				this.checkOperationalRecordsUpdate(
					entry.category,
					data.operational_records,
				);
			}
		}

		let parentEntry: CashFlowEntity | null = null;

		if (
			entry.parent_id &&
			(data.category || data.amount || data.currency)
		) {
			parentEntry = await this.findById(entry.parent_id, false);

			const refundedAmount = await this.getRefundedAmountSum(
				entry.parent_id,
			);

			await this.checkRefund({
				category: data.category || entry.category,
				inputAmount: data.amount || entry.amount,
				currency: data.currency || entry.currency,
				parentEntry: parentEntry,
				refundedAmount: refundedAmount,
			});
		}

		/*
		 * The rate belongs to the currency it was quoted for, and `exchange_rate` is not in
		 * `paramsUpdateList` - so a currency changed on its own would leave the row converting
		 * at a rate nobody ever published for it. Re-read at the *current* day rather than the
		 * day of the entry: the amount is being restated now, and the entry is still in a
		 * mutable status, so it has not been reported on.
		 */
		if (data.currency && data.currency !== entry.currency) {
			entry.exchange_rate = await this.getExchangeRate(
				data.currency,
				parentEntry,
			);
		}

		/*
		 * Only the types the submitted category allows are kept; the rest are dropped rather than
		 * refused, the same way `create` drops them.
		 *
		 * `order` is among them, so an operator can name the document a movement belongs to after
		 * the fact. `setupOperationalRecord` reads a type present with no id as an instruction to
		 * unlink, which means a form that renders the order field must omit the key entirely when
		 * it has nothing to say rather than submit it empty - submitting it empty cuts a captured
		 * payment loose from the order it confirmed.
		 */
		const operationalRecords = this.dropInvalidOperationalRecords(
			data.category || entry.category,
			data.operational_records,
		);

		const resultEntry = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(CashFlowEntity);

			Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

			const resultEntry = await repository.save(entry);

			if (operationalRecords) {
				await Promise.all(
					Object.entries(operationalRecords).map(
						([operational_record_type, entity_id]) =>
							this.repository.setupOperationalRecord(manager, {
								cash_flow_id: resultEntry.id,
								operational_record_type:
									operational_record_type as OperationalRecordType,
								entity_id: entity_id,
							}),
					),
				);
			}

			return resultEntry;
		});

		// Not through `update()`, so the clean this feature's other writes inherit does not
		// apply here. Covers the operational records written above as well: they are cached
		// under `cash_flow:<id>:operational-records`, inside the same prefix.
		await cleanEntityCache(CashFlowEntity, resultEntry.id);

		return resultEntry;
	}

	/**
	 * Capturing goes through `completeWithin`, so the client ledger entry is written in the same
	 * transaction as the status - a movement is never completed without it. The announcement is
	 * made **after that commit**: what runs downstream - allocating the money to the client's open
	 * documents, moving their orders along - opens transactions of its own. See
	 * `invoice.hooks.ts` for why that chain is not held inside one, and for what a
	 * failure downstream leaves behind.
	 */
	public async updateStatus(
		entry: CashFlowEntity,
		newStatus: CashFlowStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		if (newStatus !== CashFlowStatusEnum.COMPLETED) {
			entry.status = newStatus;

			await this.update(entry);

			return;
		}

		await dataSource.transaction((manager) =>
			this.completeWithin(manager, entry),
		);

		await cleanEntityCache(CashFlowEntity, entry.id);

		await notifyCashFlowCompleted({
			cash_flow_id: entry.id,
		});
	}

	/**
	 * @description Used by `updateStatus`, and by a caller completing a movement inside its own
	 * transaction - a reversal paying its refund as it is issued
	 *
	 * Marks the movement `completed` and books it on the client ledger, both through the caller's
	 * manager: the ledger is the money that moved, and this is the moment it moved. With the
	 * `client-ledger` feature absent the booking does nothing.
	 *
	 * Announcing it downstream is the caller's - it has to happen after the caller's commit.
	 */
	public async completeWithin(
		manager: EntityManager,
		entry: CashFlowEntity,
	): Promise<CashFlowEntity> {
		entry.status = CashFlowStatusEnum.COMPLETED;

		const completed = await manager
			.getRepository(CashFlowEntity)
			.save(entry);

		await recordLedgerMovement(manager, completed);

		return completed;
	}

	/**
	 * The order a movement was raised for, or null when it was raised for nobody's document.
	 *
	 * An id and nothing more: the row it points at lives in a table this feature does not import,
	 * and the unique index over `(cash_flow_id, operational_record_type)` means there is at most
	 * one of them.
	 */
	public findOrderId(cashFlowId: number): Promise<number | null> {
		return this.findOperationalRecordId(
			cashFlowId,
			OperationalRecordTypeEnum.ORDER,
		);
	}

	/**
	 * The movements filed under an order in the given statuses, read through the caller's manager.
	 * `lockRows` takes a write lock on the movements alone (`FOR UPDATE OF cash_flow`) - the
	 * record rows they are joined through are not written.
	 */
	private findForOrder(
		manager: EntityManager,
		orderId: number,
		statuses: readonly CashFlowStatus[],
		lockRows = false,
	): Promise<CashFlowEntity[]> {
		const query = manager
			.getRepository(CashFlowEntity)
			.createQueryBuilder('cash_flow')
			.innerJoin(
				OperationalRecordEntity,
				'record',
				'record.cash_flow_id = cash_flow.id AND record.operational_record_type = :type AND record.entity_id = :orderId',
				{ type: OperationalRecordTypeEnum.ORDER, orderId: orderId },
			)
			.where('cash_flow.status IN (:...statuses)', {
				statuses: [...statuses],
			})
			.orderBy('cash_flow.id');

		if (lockRows) {
			query.setLock('pessimistic_write', undefined, ['cash_flow']);
		}

		return query.getMany();
	}

	/**
	 * @description Used by `InvoicePublicController.billing`, once the order is known to be the caller's
	 *
	 * The money filed under an order, as its buyer is shown it: how it was paid, where it stands
	 * and how much, gross. A refund is a movement out, inherits its parent's records and so is
	 * listed here too - `direction` tells them apart, and `gross_amount` is unsigned. Every status
	 * is listed, a failed or canceled attempt included, since the buyer made it and may look for it.
	 *
	 * Not filtered by client here: the caller has already resolved the order through its owner, and
	 * a movement filed under an order belongs to that order's client.
	 */
	public async findPublicForOrder(orderId: number): Promise<
		{
			id: number;
			direction: CashFlowDirection;
			method: CashFlowMethod;
			status: CashFlowStatus;
			gross_amount: number;
			currency: string;
			created_at: Date;
			updated_at: Date | null;
		}[]
	> {
		const rows = await this.findForOrder(
			dataSource.manager,
			orderId,
			Object.values(CashFlowStatusEnum),
		);

		return rows.map((row) => ({
			id: row.id,
			direction: row.direction,
			method: row.method,
			status: row.status,
			gross_amount: toGrossAmount(
				Number(row.amount),
				Number(row.vat_rate),
			),
			currency: row.currency,
			created_at: row.created_at,
			updated_at: row.updated_at,
		}));
	}

	/**
	 * @description Used by `cart`'s answer to `findOrdersAwaitingPayment`
	 *
	 * Which of the given orders have money in still open under them: requested, authorized or
	 * waiting on the payer's action, and so neither captured nor gone. One read for the whole set,
	 * since a buyer's order list asks it per page.
	 */
	public async findOrdersWithOpenPayment(
		orderIds: readonly number[],
	): Promise<Set<number>> {
		if (orderIds.length === 0) {
			return new Set();
		}

		const rows = await dataSource
			.getRepository(OperationalRecordEntity)
			.createQueryBuilder('record')
			.innerJoin(
				CashFlowEntity,
				'cash_flow',
				'cash_flow.id = record.cash_flow_id',
			)
			.select('DISTINCT record.entity_id', 'order_id')
			.where('record.operational_record_type = :type', {
				type: OperationalRecordTypeEnum.ORDER,
			})
			.andWhere('record.entity_id IN (:...orderIds)', {
				orderIds: [...orderIds],
			})
			.andWhere('cash_flow.direction = :direction', {
				direction: CashFlowDirectionEnum.IN,
			})
			.andWhere('cash_flow.status IN (:...statuses)', {
				statuses: [
					CashFlowStatusEnum.PENDING,
					CashFlowStatusEnum.AUTHORIZED,
					CashFlowStatusEnum.REQUIRES_ACTION,
				],
			})
			.getRawMany<{ order_id: number | string }>();

		return new Set(rows.map((row) => Number(row.order_id)));
	}

	/**
	 * @description Used by `invoice`'s answer to `isOrderClientLocked`
	 *
	 * Whether any movement still stands under an order - pending, authorized or completed. A failed,
	 * canceled or expired one never moved money and holds nothing for the client it names.
	 */
	public async hasMovementsForOrder(orderId: number): Promise<boolean> {
		const rows = await this.findForOrder(dataSource.manager, orderId, [
			CashFlowStatusEnum.PENDING,
			CashFlowStatusEnum.AUTHORIZED,
			CashFlowStatusEnum.REQUIRES_ACTION,
			CashFlowStatusEnum.COMPLETED,
		]);

		return rows.length > 0;
	}

	/**
	 * @description Used by `OrderSettlementService` to confirm an order its payment covers
	 *
	 * What has been captured for an order, gross, in the movements' own currency: completed money in
	 * filed under it, less completed refunds out - a refund inherits its parent's records when it is
	 * written, so it is filed under the same order. Compared against the order's own total, which is
	 * in the currency the checkout asked for the money in.
	 */
	public async sumCompletedForOrder(orderId: number): Promise<number> {
		const rows = await this.findForOrder(dataSource.manager, orderId, [
			CashFlowStatusEnum.COMPLETED,
		]);

		return roundMoney(
			rows.reduce(
				(sum, row) =>
					sum +
					(row.direction === CashFlowDirectionEnum.IN ? 1 : -1) *
						toGrossAmount(Number(row.amount), Number(row.vat_rate)),
				0,
			),
		);
	}

	/**
	 * @description Used by `cart`'s answer to `syncOrderPayment`, inside the line-replace transaction
	 *
	 * Restates the one payment request still `pending` for an order at a new gross total. Anything
	 * further along - authorized, captured - stated an amount to a gateway or took money, and is
	 * never moved; nor is a request when the order has several pending, since which of them the new
	 * total belongs to is not this method's to guess.
	 *
	 * Returns the id it moved, for the caller to drop its cache once the transaction commits.
	 */
	public async restatePendingForOrder(
		manager: EntityManager,
		orderId: number,
		grossTotal: number,
	): Promise<number | null> {
		const pending = (
			await this.findForOrder(manager, orderId, [
				CashFlowStatusEnum.PENDING,
			])
		).filter((row) => row.direction === CashFlowDirectionEnum.IN);

		if (pending.length !== 1) {
			return null;
		}

		const request = pending[0];
		const vatRate = Number(request.vat_rate);

		await manager.getRepository(CashFlowEntity).update(request.id, {
			// `amount` is net of the movement's own rate; a checkout request carries 0
			amount: this.inputAmount(grossTotal / (1 + vatRate / 100)),
		});

		return request.id;
	}

	/**
	 * @description Used by `cart`'s answer to `cancelOrderPayment`, inside the cancel transaction
	 *
	 * Cancels the payment requests still `pending` for an order, and reports whether money under it
	 * got further - authorized, awaiting the payer's action or captured. Those are left as they
	 * are: an authorization is released and a capture refunded at the gateway, neither by a status
	 * written here. The rows read are locked, so a gateway callback racing the cancel waits for it
	 * and then finds the request canceled.
	 *
	 * Returns the ids it canceled, for the caller to drop their cache once the transaction commits.
	 */
	public async cancelPendingForOrder(
		manager: EntityManager,
		orderId: number,
	): Promise<{ hasProcessed: boolean; canceledIds: number[] }> {
		const rows = (
			await this.findForOrder(
				manager,
				orderId,
				[
					CashFlowStatusEnum.PENDING,
					CashFlowStatusEnum.AUTHORIZED,
					CashFlowStatusEnum.REQUIRES_ACTION,
					CashFlowStatusEnum.COMPLETED,
				],
				true,
			)
		).filter((row) => row.direction === CashFlowDirectionEnum.IN);

		const pending = rows.filter(
			(row) => row.status === CashFlowStatusEnum.PENDING,
		);

		for (const row of pending) {
			assertValidStatusTransition(
				STATUS_TRANSITIONS,
				row.status,
				CashFlowStatusEnum.CANCELED,
			);
		}

		if (pending.length > 0) {
			await manager.getRepository(CashFlowEntity).update(
				pending.map((row) => row.id),
				{ status: CashFlowStatusEnum.CANCELED },
			);
		}

		return {
			hasProcessed: rows.length > pending.length,
			canceledIds: pending.map((row) => row.id),
		};
	}

	/**
	 * The client a movement was made with: its own `client` record, or the one on its parent.
	 * A refund inherits its parent's records when it is written (`createWithin`), so the fallback
	 * only answers for a refund whose parent was filed under a client after the refund was made.
	 *
	 * Read through the caller's manager, so a caller inside a transaction - the demo seed runs
	 * every seed in one, an issue refunds in one - sees the records it has not committed yet.
	 */
	public async findClientId(
		cashFlow: Pick<CashFlowEntity, 'id' | 'parent_id'>,
		manager: EntityManager = dataSource.manager,
	): Promise<number | null> {
		const own = await this.findRecordIdWithin(
			manager,
			cashFlow.id,
			OperationalRecordTypeEnum.CLIENT,
		);

		if (own || !cashFlow.parent_id) {
			return own;
		}

		return this.findRecordIdWithin(
			manager,
			cashFlow.parent_id,
			OperationalRecordTypeEnum.CLIENT,
		);
	}

	/** Every live record a movement is filed under, as `{ type: entity_id }`. */
	private async findRecordsWithin(
		manager: EntityManager,
		cashFlowId: number,
	): Promise<Partial<Record<OperationalRecordType, number>>> {
		const records = await manager
			.getRepository(OperationalRecordEntity)
			.find({
				select: { operational_record_type: true, entity_id: true },
				where: { cash_flow_id: cashFlowId },
			});

		return Object.fromEntries(
			records.map((record) => [
				record.operational_record_type,
				record.entity_id,
			]),
		);
	}

	private async findRecordIdWithin(
		manager: EntityManager,
		cashFlowId: number,
		type: OperationalRecordType,
	): Promise<number | null> {
		const record = await manager
			.getRepository(OperationalRecordEntity)
			.findOne({
				select: { entity_id: true },
				where: {
					cash_flow_id: cashFlowId,
					operational_record_type: type,
				},
			});

		return record?.entity_id ?? null;
	}

	/**
	 * The row of a given type a movement is filed under, as an id and nothing more.
	 *
	 * The unique index over `(cash_flow_id, operational_record_type)` means there is at most one
	 * of each, so this answers with a value rather than a list. What the id points at is the
	 * caller's business - `order` in particular lives in a table this feature does not import.
	 */
	public async findOperationalRecordId(
		cashFlowId: number,
		type: OperationalRecordType,
	): Promise<number | null> {
		const record = await getOperationalRecordRepository()
			.createQuery()
			.select(['operational_record.entity_id'])
			.filterBy('cash_flow_id', cashFlowId)
			.filterBy('operational_record_type', type)
			.first();

		return record?.entity_id ?? null;
	}

	public async delete(id: number, force: boolean) {
		const entry = await this.repository
			.createQuery()
			.joinAndSelect('cash_flow.refunds', 'refunds', 'LEFT')
			.filterById(id)
			.first();

		if (!entry) {
			return;
		}

		if (entry.refunds?.length) {
			if (force) {
				await this.repository
					.createQuery()
					.filterBy('parent_id', id)
					.delete(true, true, true);
			} else {
				throw new CustomError(
					409,
					lang('cash-flow.error.cannot_delete_with_refunds'),
				);
			}
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	/**
	 * Find a cash flow entry by ID
	 * IF `userId` is provided, the `cash-flow` entry must have an `operational_record` with the `entity_id` matching the `userId`
	 *
	 * @param id
	 * @param withDeleted
	 */
	public findById(id: number, withDeleted: boolean): Promise<CashFlowEntity> {
		const query = this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted);

		return query.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<CashFlowValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.filterBy('parent_id', data.filter.parent_id)
			.filterBy('direction', data.filter.direction)
			.filterBy('category_type', data.filter.category_type)
			.filterBy('category', data.filter.category)
			.filterBy('method', data.filter.method)
			.filterBy('status', data.filter.status)
			.filterBy('currency', data.filter.currency)
			.filterByRange(
				'created_at',
				data.filter.create_at_start,
				data.filter.create_at_end,
			);

		if (data.filter.client_id) {
			query
				.joinAndSelect(
					'cash_flow.operational_records',
					'operational_records_client',
					'INNER',
				)
				.filterBy(
					'operational_records_client.entity_id',
					data.filter.client_id,
				)
				.filterBy(
					'operational_records_client.operational_record_type',
					'client',
				);
		}

		if (data.filter.vendor_id) {
			query
				.joinAndSelect(
					'cash_flow.operational_records',
					'operational_records_vendor',
					'INNER',
				)
				.filterBy(
					'operational_records_vendor.entity_id',
					data.filter.vendor_id,
				)
				.filterBy(
					'operational_records_vendor.operational_record_type',
					'vendor',
				);
		}

		if (data.filter.order_id) {
			query
				.joinAndSelect(
					'cash_flow.operational_records',
					'operational_records_order',
					'INNER',
				)
				.filterBy(
					'operational_records_order.entity_id',
					data.filter.order_id,
				)
				.filterBy(
					'operational_records_order.operational_record_type',
					'order',
				);
		}

		query
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit);

		return query.all(true);
	}

	public async findOperationalRecords(cash_flow_id: number) {
		const entries = (await getOperationalRecordRepository()
			.createQuery()
			.filterBy('cash_flow_id', cash_flow_id)
			.all(false)) as OperationalRecordWithRelations[];

		await Promise.all(
			entries.map(async (entry) => {
				switch (entry.operational_record_type) {
					case OperationalRecordTypeEnum.CLIENT:
						entry.client = await clientService.getEntryData({
							id: entry.entity_id,
							withDeleted: false,
						});
						break;
					case OperationalRecordTypeEnum.VENDOR:
						entry.vendor = await vendorService.getEntryData({
							id: entry.entity_id,
							withDeleted: false,
						});
						break;
					case OperationalRecordTypeEnum.ORDER:
						entry.order = await resolveOperationalRecordOrder(
							entry.entity_id,
						);
						break;
				}
			}),
		);

		return entries;
	}
}

export const cashFlowService = new CashFlowService(getCashFlowRepository());
