import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import InvoiceEntity from '@/features/invoice/invoice.entity';
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

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			InvoiceEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.invoiceService.getEntryData({
				id: data.id,
				withDeleted: withDeleted,
			}),
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

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.invoiceService.delete(data.id);

		res.locals.output.message(lang('invoice.success.delete'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.invoiceService.findByFilter(
			data,
			this.policy.allowDeleted(res.locals.auth),
		);

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

		res.locals.output.message(lang('invoice.success.status_update'));

		res.json(res.locals.output);
	});

	/**
	 * Raises the charge a revenue movement is owed a document for, and settles it with that same
	 * movement.
	 *
	 * Gated by `canCreate` - it writes a document - and the settlement follows it here rather than
	 * inside `raiseForCashFlow` because pressing this is the operator saying both should happen.
	 * It is a no-op for a movement not yet captured, which leaves the document `unpaid` for the
	 * capture to settle later.
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

			// Null when a live charge already stands for the movement's order, or when the
			// movement has already been allocated - there is a document for this money somewhere
			// and raising a second one is not this route's call
			if (!entry) {
				throw new CustomError(
					409,
					lang('invoice.error.cash_flow_already_invoiced'),
				);
			}

			await this.invoicePaymentService.settleFromCashFlow(
				entry,
				data.cash_flow_id,
			);

			res.locals.output.data(entry);
			res.locals.output.message(lang('invoice.success.create'));

			res.status(201).json(res.locals.output);
		},
	);

	public creditNote = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(
			this.validator.creditNote,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const parentEntry = await this.invoiceService.findById(data.id, false);

		const entry = await this.invoiceService.createCreditNote(
			parentEntry,
			data,
		);

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.credit_note'));

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

		res.locals.output.data(entry);
		res.locals.output.message(lang('invoice.success.payment_create'));

		res.status(201).json(res.locals.output);
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
);
