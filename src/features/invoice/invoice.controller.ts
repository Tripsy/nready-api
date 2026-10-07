import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import InvoiceEntity, {
	InvoiceStatusEnum,
} from '@/features/invoice/invoice.entity';
import { notifyOrderStateChanged } from '@/features/invoice/invoice.hooks';
import {
	type InvoicePolicy,
	invoicePolicy,
} from '@/features/invoice/invoice.policy';
import {
	type InvoiceService,
	invoiceService,
} from '@/features/invoice/invoice.service';
import { InvoiceValidator } from '@/features/invoice/invoice.validator';
import {
	type InvoiceLineService,
	invoiceLineService,
} from '@/features/invoice/invoice-line.service';
import {
	type InvoicePaymentService,
	invoicePaymentService,
} from '@/features/invoice/invoice-payment.service';
import {
	type InvoiceSettlementService,
	invoiceSettlementService,
} from '@/features/invoice/invoice-settlement.service';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class InvoiceController extends BaseController {
	constructor(
		private policy: InvoicePolicy,
		private validator: InvoiceValidator,
		private cache: CacheProvider,
		private invoiceService: InvoiceService,
		private invoiceLineService: InvoiceLineService,
		private invoicePaymentService: InvoicePaymentService,
		private invoiceSettlementService: InvoiceSettlementService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.invoiceService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.create'));

		res.status(201).json(res.locals.output);
	});

	public createCustom = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.createCustom, req.body, res);

		const entry = await this.invoiceService.createCustom(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const cacheKey = this.cache.buildKey(
			InvoiceEntity.NAME,
			data.id.toString(),
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.invoiceService.getEntryData({ id: data.id }),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	public update = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.update,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const existingEntry = await this.invoiceService.findById(
			data.id,
			false,
		);

		const entry = await this.invoiceService.updateData(existingEntry, data);

		res.locals.output.message(lang('invoice.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.invoiceService.findByFilter(data);

		res.locals.output.data({
			entries: entries,
			pagination: {
				page: data.page,
				limit: data.limit,
				total: total,
			},
			query: data,
		});

		res.json(res.locals.output);
	});

	/**
	 * Both moves a document can make. `issued` spends a number from `document_series` and freezes
	 * the parties onto the row; `canceled` invalidates it. The service decides which, behind the
	 * one transition check, so `STATUS_TRANSITIONS` stays the only thing saying what is allowed.
	 *
	 * An issued document is offered whatever money the client already holds, and either move can
	 * settle the order behind it - a reversal taking the last of a document back, a cancel
	 * removing the one unpaid draft.
	 */
	public statusUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.statusUpdate,
			req.params,
			res,
		);

		const existingEntry = await this.invoiceService.findById(
			data.id,
			false,
		);

		await this.invoiceService.updateStatus(existingEntry, data.status);

		if (data.status === InvoiceStatusEnum.ISSUED) {
			await this.invoiceSettlementService.afterIssued([existingEntry]);
		} else {
			await notifyOrderStateChanged({
				order_ids: existingEntry.order_id
					? [existingEntry.order_id]
					: [],
			});
		}

		res.locals.output.message(lang('invoice.success.status_update'));

		res.json(res.locals.output);
	});

	/**
	 * Raises the document a revenue movement is owed, then settles the client's money against
	 * their open documents.
	 *
	 * Gated by `canCreate` - it writes a document. Settling runs the client's FIFO like every
	 * other path, so the movement settles the new document only if nothing older is still open;
	 * a movement not yet captured settles nothing until its capture announces itself.
	 */
	public raiseForCashFlow = asyncHandler(
		async (req: Request, res: Response) => {
			this.policy.canCreate(res.locals.auth);

			const data = this.validate(
				this.validator.raiseForCashFlow,
				req.params,
				res,
			);

			const entry = await this.invoiceService.raiseForCashFlow(
				data.cash_flow_id,
			);

			// Null when the movement's order is already billed in full, or when the movement has
			// already been allocated - there is a document for this money somewhere and raising
			// a second one is not this route's call
			if (!entry) {
				throw new CustomError(
					409,
					lang('invoice.error.cash_flow_already_invoiced'),
				);
			}

			await this.invoiceSettlementService.afterIssued([entry]);

			res.locals.output.data(entry);
			res.locals.output.message(lang('invoice.success.create'));

			res.status(201).json(res.locals.output);
		},
	);

	/**
	 * Raises a reversal against an issued document, as a draft of the same scope - issued, and
	 * numbered from the same series, like any other document.
	 */
	public reverse = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(
			this.validator.reverse,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const parentEntry = await this.invoiceService.findById(data.id, false);

		const entry = await this.invoiceService.createReversal(
			parentEntry,
			data,
		);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.reverse'));

		res.status(201).json(res.locals.output);
	});

	public lineCreate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.lineCreate,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const invoice = await this.invoiceService.findById(data.id, false);

		const entry = await this.invoiceLineService.create(invoice, data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.line_create'));

		res.status(201).json(res.locals.output);
	});

	public lineUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.lineUpdate,
			{
				...req.body,
				...req.params,
			},
			res,
		);

		const invoice = await this.invoiceService.findById(data.id, false);

		const entry = await this.invoiceLineService.updateData(invoice, data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.line_update'));

		res.json(res.locals.output);
	});

	public lineDelete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(this.validator.lineDelete, req.params, res);

		const invoice = await this.invoiceService.findById(data.id, false);

		await this.invoiceLineService.delete(invoice, data.line_id);

		res.locals.output.message(lang('invoice.success.line_delete'));

		res.json(res.locals.output);
	});

	public paymentCreate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.paymentCreate,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const invoice = await this.invoiceService.findById(data.id, false);

		const entry = await this.invoicePaymentService.create(invoice, data);

		await notifyOrderStateChanged({
			order_ids: invoice.order_id ? [invoice.order_id] : [],
		});

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.payment_create'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * Takes every allocation off a document, so the money can be allocated to another of the
	 * client's documents. Nothing is re-spread and the order is not re-read - see
	 * `InvoicePaymentService.release`.
	 */
	public paymentClear = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.paymentClear,
			req.params,
			res,
		);

		const invoice = await this.invoiceService.findById(data.id, false);

		const count = await this.invoicePaymentService.clear(invoice);

		res.locals.output.message(
			lang('invoice.success.payment_clear', { count: String(count) }),
		);

		res.json(res.locals.output);
	});

	public paymentDelete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.paymentDelete,
			req.params,
			res,
		);

		const invoice = await this.invoiceService.findById(data.id, false);

		await this.invoicePaymentService.delete(invoice, data.payment_id);

		res.locals.output.message(lang('invoice.success.payment_delete'));

		res.json(res.locals.output);
	});
}

export const invoiceController = new InvoiceController(
	invoicePolicy,
	new InvoiceValidator('invoice'),
	cacheProvider,
	invoiceService,
	invoiceLineService,
	invoicePaymentService,
	invoiceSettlementService,
);
