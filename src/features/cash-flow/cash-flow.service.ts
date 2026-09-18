import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	type CashFlowCategoryType,
	CashFlowCategoryTypeEnum,
	type CashFlowDirection,
	type CashFlowStatus,
	getExpectedCategoryType,
	getExpectedDirection,
	MUTABLE_STATUSES,
	REFUNDABLE_STATUSES,
	STATUS_TRANSITIONS,
} from '@/features/cash-flow/cash-flow.entity';
import { getCashFlowRepository } from '@/features/cash-flow/cash-flow.repository';
import {
	type CashFlowValidator,
	paramsUpdateList,
} from '@/features/cash-flow/cash-flow.validator';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import {
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
import { arrayHasValue, pickValuesFromObject } from '@/helpers/objects.helper';
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
	 *
	 * There is no fallback when the currency has never been published. Converting at an invented
	 * rate silently mis-states every base-currency total that sums this column, so the entry is
	 * refused instead and the rate is entered by hand or imported first.
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

		const operationalRecords = this.dropInvalidOperationalRecords(
			data.category,
			data.operational_records,
		);

		return dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(CashFlowEntity);

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

		if (!arrayHasValue(entry.status, MUTABLE_STATUSES)) {
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

		if (data.operational_records) {
			this.checkOperationalRecords(
				data.category || entry.category,
				data.operational_records,
			);
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

	public async updateStatus(
		entry: CashFlowEntity,
		newStatus: CashFlowStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
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
				}
			}),
		);

		return entries;
	}
}

export const cashFlowService = new CashFlowService(getCashFlowRepository());
