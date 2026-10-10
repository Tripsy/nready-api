import type { Request, Response } from 'express';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import {
	type InvoicePolicy,
	invoicePolicy,
} from '@/features/invoice/invoice.policy';
import {
	type InvoiceService,
	invoiceService,
} from '@/features/invoice/invoice.service';
import { InvoiceValidator } from '@/features/invoice/invoice.validator';
import { orderService } from '@/features/order/order.service';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The billing side of an order, for its buyer: the documents raised for it, each one whole enough
 * to print, and the money filed under it. No permission is checked, but an account is, and the order has to be billed to one of
 * its clients - resolved through `OrderService.findOwnById` first, so somebody else's order
 * answers the same 404 as a missing one and no row of theirs is read.
 *
 * Lives in `invoice` because it is the one feature that depends on both `order` and `cash-flow`;
 * neither of those can import the other, and `order` cannot reach either.
 */
class InvoicePublicController extends BaseController {
	constructor(
		private policy: InvoicePolicy,
		private validator: InvoiceValidator,
		private invoiceService: InvoiceService,
	) {
		super();
	}

	public billing = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(
			this.validator.publicBilling,
			req.params,
			res,
		);

		await orderService.findOwnById(
			data.order_id,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		const [invoices, payments] = await Promise.all([
			this.invoiceService.findPublicForOrder(data.order_id),
			cashFlowService.findPublicForOrder(data.order_id),
		]);

		res.locals.output.data({
			invoices: invoices,
			payments: payments,
		});

		res.json(res.locals.output);
	});

	/**
	 * One issued document of the order, whole enough to print. Not cached, for the reason
	 * `OrderService.getOwnEntryData` gives: the ownership read runs on every request regardless.
	 */
	public document = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(
			this.validator.publicDocument,
			req.params,
			res,
		);

		await orderService.findOwnById(
			data.order_id,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		res.locals.output.data(
			await this.invoiceService.getPublicDocument(data.order_id, data.id),
		);

		res.json(res.locals.output);
	});
}

export const invoicePublicController = new InvoicePublicController(
	invoicePolicy,
	new InvoiceValidator('invoice'),
	invoiceService,
);
