import { Configuration } from '@/config/settings.config';
import {
	isDirectRun,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CashFlowEntity, {
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import ClientEntity, { ClientTypeEnum } from '@/features/client/client.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import InvoiceEntity, {
	type BillingDetails,
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	InvoiceTypeEnum,
	resolvePaymentStatus,
	type SellerDetails,
} from '@/features/invoice/invoice.entity';
import InvoiceLineEntity, {
	InvoiceLineKindEnum,
} from '@/features/invoice/invoice-line.entity';
import InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import OrderEntity, { OrderStatusEnum } from '@/features/order/order.entity';
import OrderLineEntity from '@/features/order/order-line.entity';
import { createFutureDate, createPastDate } from '@/helpers/date.helper';
import { roundMoney } from '@/helpers/shop.helper';

const TARGET = 18;

/** How many of the seeded documents stay open as drafts, one in this many. */
const DRAFT_EVERY = 6;

/** Days a seeded document is given to be settled, as `invoice.dueDays` would give it. */
const DUE_DAYS = Configuration.get('invoice.dueDays');

type OrderWithClient = {
	id: number;
	client_id: number;
	issued_at: Date;
};

type SettleableMovement = {
	id: number;
	currency: string;
	gross: number;
};

/**
 * A billing snapshot built from the client alone.
 *
 * The seeded orders carry no `billing_address_id` - `order.seed.ts` raises them without one - so
 * there is no address row to flatten here the way `InvoiceService.issue` does. The country is the
 * deployment's own, since that is the jurisdiction the rest of the seeded data sits in, and it is
 * the one field a document cannot go out without.
 */
function buildBillingDetails(client: ClientEntity): BillingDetails {
	const shared = {
		address_country: Configuration.get('company.addressCountry'),
		address_region: null,
		address_city: null,
		details: null,
		postal_code: null,
		contact_name: client.contact_name,
		contact_email: client.contact_email,
		contact_phone: client.contact_phone,
		iban: client.iban,
		bank_name: client.bank_name,
	};

	return client.client_type === ClientTypeEnum.COMPANY
		? {
				...shared,
				type: ClientTypeEnum.COMPANY,
				company_name: client.company_name ?? 'Company',
				company_cui: client.company_cui,
				company_reg_com: client.company_reg_com,
			}
		: {
				...shared,
				type: ClientTypeEnum.PERSON,
				person_name: client.person_name ?? 'Person',
				person_identification_number: null,
			};
}

function buildSellerDetails(): SellerDetails {
	return {
		company_name: Configuration.get('company.name'),
		company_cui: Configuration.get('company.cui'),
		company_reg_com: Configuration.get('company.regCom'),
		address_country: Configuration.get('company.addressCountry'),
		address_region: Configuration.get('company.addressRegion'),
		address_city: Configuration.get('company.addressCity'),
		details: Configuration.get('company.addressDetails'),
		postal_code: Configuration.get('company.postalCode'),
		contact_name: Configuration.get('company.contactName'),
		contact_email: Configuration.get('company.contactEmail'),
		contact_phone: Configuration.get('company.contactPhone'),
		iban: Configuration.get('company.iban'),
		bank_name: Configuration.get('company.bankName'),
	};
}

/**
 * Demo invoices raised from the seeded order book, each with its lines and some of them settled
 * against a seeded cash movement.
 *
 * **The natural key is the row count**, as in `order.seed.ts` and for the same reason: a document
 * is identified by the number its series hands out, and that number cannot be a pure function of
 * the loop index - the counter is shared with every invoice the application itself raises. Numbers
 * are allocated through `documentSeriesService`, in the seed's own transaction, exactly as the
 * application does.
 */
export const invoiceSeed: SeedDefinition = {
	name: 'invoice',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(InvoiceEntity);
		const lineRepository = manager.getRepository(InvoiceLineEntity);

		const tableTotal = await repository.count({ withDeleted: true });

		/*
		 * Only orders that were agreed: a `pending` order is still being amended and a canceled
		 * one was never charged, so neither is something the business would have invoiced.
		 */
		const orders = (await manager
			.getRepository(OrderEntity)
			.createQueryBuilder('order')
			.select([
				'order.id AS id',
				'order.client_id AS client_id',
				'order.issued_at AS issued_at',
			])
			.where('order.deleted_at IS NULL')
			.andWhere('order.status IN (:...statuses)', {
				statuses: [
					OrderStatusEnum.CONFIRMED,
					OrderStatusEnum.COMPLETED,
				],
			})
			.orderBy('order.id', 'ASC')
			.getRawMany<OrderWithClient>()) as OrderWithClient[];

		const missing = Math.max(
			0,
			Math.min(TARGET, orders.length) - tableTotal,
		);

		if (missing === 0) {
			return {
				entity: 'invoice',
				alreadyPresent: tableTotal,
				inserted: 0,
				target: Math.min(TARGET, orders.length),
				tableTotal: tableTotal,
			};
		}

		const clients = await manager.getRepository(ClientEntity).find();
		const clientById = new Map(
			clients.map((client) => [client.id, client]),
		);

		/*
		 * What a seeded allocation may draw on: money that actually moved, in and from a client.
		 * The ceiling is the movement's **gross** worth - `cash_flow.amount` is net and scaled by
		 * four decimals, so allocating against the raw column would overstate it wildly.
		 */
		const movements = await manager.getRepository(CashFlowEntity).find({
			where: {
				status: CashFlowStatusEnum.COMPLETED,
				direction: CashFlowDirectionEnum.IN,
			},
			order: { id: 'ASC' },
		});

		const settleable: SettleableMovement[] = movements.map((movement) => ({
			id: movement.id,
			currency: movement.currency,
			gross: toGrossAmount(
				Number(movement.amount),
				Number(movement.vat_rate),
			),
		}));

		const usedMovements = new Set<number>();
		let inserted = 0;

		for (let index = 0; index < missing; index++) {
			const order = orders[tableTotal + index];

			if (!order) {
				break;
			}

			const orderLines = await manager
				.getRepository(OrderLineEntity)
				.find({ where: { order_id: order.id }, order: { id: 'ASC' } });

			if (orderLines.length === 0) {
				continue;
			}

			const client = clientById.get(order.client_id);

			if (!client) {
				continue;
			}

			const isDraft = index % DRAFT_EVERY === 0;
			const currency =
				orderLines[0]?.currency ?? Configuration.currency();

			const issuedAt = isDraft
				? null
				: createPastDate(randomInt(random, 1, 60) * 86400);

			const reference = isDraft
				? null
				: await documentSeriesService.allocate(
						manager,
						DocumentTypeEnum.INVOICE,
					);

			const invoice = await repository.save(
				repository.create({
					order_id: order.id,
					ref_code: reference?.code ?? null,
					ref_number: reference?.number ?? null,
					status: isDraft
						? InvoiceStatusEnum.DRAFT
						: InvoiceStatusEnum.ISSUED,
					type: InvoiceTypeEnum.CHARGE,
					currency: currency,
					exchange_rate: Number(orderLines[0]?.exchange_rate ?? 1),
					issued_at: issuedAt,
					due_at: issuedAt
						? new Date(issuedAt.getTime() + DUE_DAYS * 86400 * 1000)
						: createFutureDate(DUE_DAYS * 86400),
					billing_details: isDraft
						? null
						: buildBillingDetails(client),
					seller_details: isDraft ? null : buildSellerDetails(),
					notes: null,
				}),
			);

			const lines = orderLines.map((orderLine) => {
				const gross = roundMoney(
					Number(orderLine.price) * Number(orderLine.quantity),
				);
				const lineNet = roundMoney(
					gross - Number(orderLine.discount_reduction),
				);
				const lineVat = roundMoney(
					(lineNet * Number(orderLine.vat_rate)) / 100,
				);

				return lineRepository.create({
					invoice_id: invoice.id,
					kind: InvoiceLineKindEnum.PRODUCT,
					order_line_id: orderLine.id,
					product_id: orderLine.product_id,
					variant_id: orderLine.variant_id,
					label: `Product #${orderLine.product_id}`,
					quantity: Number(orderLine.quantity),
					unit_price: Number(orderLine.price),
					vat_rate: Number(orderLine.vat_rate),
					discount: orderLine.discount ?? null,
					discount_reduction: Number(orderLine.discount_reduction),
					line_net: lineNet,
					line_vat: lineVat,
					line_total: roundMoney(lineNet + lineVat),
					notes: null,
				});
			});

			await lineRepository.save(lines);

			const totals = lines.reduce(
				(carry, line) => ({
					total_net: carry.total_net + Number(line.line_net),
					total_discount_reduction:
						carry.total_discount_reduction +
						Number(line.discount_reduction),
					total_vat: carry.total_vat + Number(line.line_vat),
					total_gross: carry.total_gross + Number(line.line_total),
				}),
				{
					total_net: 0,
					total_discount_reduction: 0,
					total_vat: 0,
					total_gross: 0,
				},
			);

			invoice.total_net = roundMoney(totals.total_net);
			invoice.total_discount_reduction = roundMoney(
				totals.total_discount_reduction,
			);
			invoice.total_vat = roundMoney(totals.total_vat);
			invoice.total_gross = roundMoney(totals.total_gross);

			// Two in three issued documents have been settled, in full or in part, so a list has
			// something to filter on in every payment status
			const movement = isDraft
				? undefined
				: settleable.find(
						(candidate) =>
							candidate.currency === invoice.currency &&
							!usedMovements.has(candidate.id) &&
							candidate.gross > 0,
					);

			if (movement && randomInt(random, 1, 3) !== 3) {
				usedMovements.add(movement.id);

				const amount = roundMoney(
					Math.min(
						movement.gross,
						invoice.total_gross *
							randomPick(random, [1, 1, 0.5, 0.3]),
					),
				);

				if (amount > 0) {
					await manager.getRepository(InvoicePaymentEntity).save(
						manager.create(InvoicePaymentEntity, {
							invoice_id: invoice.id,
							cash_flow_id: movement.id,
							amount: amount,
							notes: null,
						}),
					);

					invoice.payment_status = resolvePaymentStatus(
						invoice.total_gross,
						amount,
					);

					invoice.paid_at =
						invoice.payment_status === InvoicePaymentStatusEnum.PAID
							? issuedAt
							: null;
				}
			}

			// Late and still unsettled, which is what a dunning run reads - the column is never
			// cleared once stamped, so it is left alone on a settled document
			if (
				invoice.due_at &&
				invoice.due_at < new Date() &&
				invoice.payment_status !== InvoicePaymentStatusEnum.PAID
			) {
				invoice.overdue_at = invoice.due_at;
			}

			await repository.save(invoice);

			inserted++;
		}

		return {
			entity: 'invoice',
			alreadyPresent: tableTotal,
			inserted: inserted,
			target: Math.min(TARGET, orders.length),
			tableTotal: tableTotal + inserted,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(invoiceSeed);
}
