import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import InvoiceEntity from '@/features/invoice/invoice.entity';
import { invoiceService } from '@/features/invoice/invoice.service';
import type { InvoiceValidator } from '@/features/invoice/invoice.validator';
import InvoiceLineEntity, {
	InvoiceLineKindEnum,
} from '@/features/invoice/invoice-line.entity';
import { getInvoiceLineRepository } from '@/features/invoice/invoice-line.repository';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * The lines of a document that is still being assembled.
 *
 * Every write here re-sums the header in the same transaction, so `invoice.total_*` can never be
 * left describing lines that have since changed - and every one of them refuses an invoice that
 * has left `draft`, because an issued document is the record of what was charged.
 */
export class InvoiceLineService {
	constructor(
		private repository: ReturnType<typeof getInvoiceLineRepository>,
	) {}

	/**
	 * @description Used in `lineCreate` method from controller
	 *
	 * Written as an `adjustment`: rounding, a manual correction, anything with no source row.
	 * A `product` or `shipping` line names the row it was raised from and is generated from the
	 * order instead - the entity's CHECK constraint holds that split.
	 */
	public async create(
		invoice: InvoiceEntity,
		data: ValidatorOutput<InvoiceValidator, 'lineCreate'>,
	): Promise<InvoiceLineEntity> {
		invoiceService.assertMutable(invoice);

		const computed = invoiceService.computeLine({
			label: data.label,
			quantity: data.quantity,
			unit_price: data.unit_price,
			vat_rate: data.vat_rate,
			discount_reduction: data.discount_reduction,
		});

		const line = await dataSource.transaction(async (manager) => {
			const saved = await manager.getRepository(InvoiceLineEntity).save(
				manager.create(InvoiceLineEntity, {
					invoice_id: invoice.id,
					kind: InvoiceLineKindEnum.ADJUSTMENT,
					label: data.label,
					quantity: data.quantity,
					unit_price: data.unit_price,
					vat_rate: data.vat_rate,
					notes: data.notes ?? null,
					...computed,
				}),
			);

			await invoiceService.recomputeTotals(manager, invoice.id);

			return saved;
		});

		await cleanEntityCache(InvoiceEntity, invoice.id);

		return line;
	}

	/**
	 * @description Used in `lineUpdate` method from controller
	 *
	 * The three stored figures are recomputed from whatever the line reads after the patch, not
	 * from the fields that happened to be sent - a quantity changed on its own still moves the
	 * VAT and the total it implies.
	 */
	public async updateData(
		invoice: InvoiceEntity,
		data: ValidatorOutput<InvoiceValidator, 'lineUpdate'>,
	): Promise<InvoiceLineEntity> {
		invoiceService.assertMutable(invoice);

		const line = await this.findByInvoice(invoice.id, data.line_id);

		Object.assign(line, {
			label: data.label ?? line.label,
			quantity: data.quantity ?? Number(line.quantity),
			unit_price: data.unit_price ?? Number(line.unit_price),
			vat_rate: data.vat_rate ?? Number(line.vat_rate),
			notes: data.notes ?? line.notes,
		});

		Object.assign(
			line,
			invoiceService.computeLine({
				label: line.label,
				quantity: Number(line.quantity),
				unit_price: Number(line.unit_price),
				vat_rate: Number(line.vat_rate),
				discount_reduction:
					data.discount_reduction ?? Number(line.discount_reduction),
			}),
		);

		const saved = await dataSource.transaction(async (manager) => {
			const saved = await manager
				.getRepository(InvoiceLineEntity)
				.save(line);

			await invoiceService.recomputeTotals(manager, invoice.id);

			return saved;
		});

		await cleanEntityCache(InvoiceEntity, invoice.id);

		return saved;
	}

	/**
	 * @description Used in `lineDelete` method from controller
	 *
	 * A soft delete, like everywhere else - but the header is re-summed from the rows that are
	 * still live, so a removed line stops counting the moment it goes.
	 */
	public async delete(invoice: InvoiceEntity, lineId: number): Promise<void> {
		invoiceService.assertMutable(invoice);

		await this.findByInvoice(invoice.id, lineId);

		await dataSource.transaction(async (manager) => {
			await manager.getRepository(InvoiceLineEntity).softDelete(lineId);

			await invoiceService.recomputeTotals(manager, invoice.id);
		});

		await cleanEntityCache(InvoiceEntity, invoice.id);
	}

	/**
	 * A line of this document. Resolved by both ids together, so a line belonging to another
	 * invoice answers the same 404 a missing one does and no ownership check is left to a later
	 * step.
	 */
	private async findByInvoice(
		invoiceId: number,
		lineId: number,
	): Promise<InvoiceLineEntity> {
		const line = await this.repository
			.createQuery()
			.filterById(lineId)
			.filterBy('invoice_id', invoiceId)
			.first();

		if (!line) {
			throw new CustomError(404, lang('invoice.error.line_not_found'));
		}

		return line;
	}
}

export const invoiceLineService = new InvoiceLineService(
	getInvoiceLineRepository(),
);
