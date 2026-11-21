import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import {
	type ComplaintPolicy,
	complaintPolicy,
} from '@/features/complaint/complaint.policy';
import {
	type ComplaintService,
	complaintService,
} from '@/features/complaint/complaint.service';
import { ComplaintValidator } from '@/features/complaint/complaint.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * The reader-facing side. No permission is checked - reporting is what any reader does - but an
 * account is: `user_id` is `NOT NULL`, so a complaint has an author by construction, and that
 * account is also the identity every write here is scoped to.
 *
 * Unlike `comment` and `rating`, there is no guest path and therefore no address hash. A complaint
 * accuses somebody, and an anonymous accusation is one nobody can be asked about.
 */
class ComplaintPublicController extends BaseController {
	constructor(
		private policy: ComplaintPolicy,
		private validator: ComplaintValidator,
		private complaintService: ComplaintService,
	) {
		super();
	}

	/** Who the request counts as - 401 for a visitor. */
	private resolveReporter(res: Response): EntityId {
		return this.policy.requireId(res.locals.auth);
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		const reporterId = this.resolveReporter(res);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.complaintService.create(data, reporterId);

		res.locals.output.data(entry);
		res.locals.output.message(lang('complaint.success.create'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * Amending one's own complaint. The target comes from the path and addresses the row together
	 * with the caller; params are spread last on purpose, so a body naming a different target
	 * cannot redirect the write to a row the path never authorized.
	 */
	public update = asyncHandler(async (req: Request, res: Response) => {
		const reporterId = this.resolveReporter(res);

		const data = this.validate(
			this.validator.publicUpdate,
			{ ...req.body, ...req.params },
			res,
		);

		const entry = await this.complaintService.updateOwn(data, reporterId);

		res.locals.output.data(entry);
		res.locals.output.message(lang('complaint.success.update'));

		res.json(res.locals.output);
	});

	/** Withdrawing a complaint - soft, so what was reported and taken back is still on record. */
	public delete = asyncHandler(async (req: Request, res: Response) => {
		const reporterId = this.resolveReporter(res);

		const data = this.validate(
			this.validator.publicDelete,
			req.params,
			res,
		);

		await this.complaintService.deleteOwn(data, reporterId);

		res.locals.output.message(lang('complaint.success.delete'));

		res.json(res.locals.output);
	});

	/**
	 * What this caller already filed against the target, or nothing. Not cached:
	 * `ComplaintEntity.HAS_CACHE` is false, and the answer is per-account - a shared cache here
	 * would hand one reader another's complaint.
	 */
	public read = asyncHandler(async (req: Request, res: Response) => {
		const reporterId = this.resolveReporter(res);

		const data = this.validate(this.validator.publicRead, req.params, res);

		res.locals.output.data({
			own: await this.complaintService.getOwn(data, reporterId),
		});

		res.json(res.locals.output);
	});
}

export const complaintPublicController = new ComplaintPublicController(
	complaintPolicy,
	new ComplaintValidator('complaint'),
	complaintService,
);
