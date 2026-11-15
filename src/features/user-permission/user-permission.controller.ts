import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import {
	type PermissionPolicy,
	permissionPolicy,
} from '@/features/permission/permission.policy';
import {
	type UserPermissionService,
	userPermissionService,
} from '@/features/user-permission/user-permission.service';
import { UserPermissionValidator } from '@/features/user-permission/user-permission.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class UserPermissionController extends BaseController {
	constructor(
		private policy: PermissionPolicy,
		private validator: UserPermissionValidator,
		private userPermissionService: UserPermissionService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canGrant(res.locals.auth);

		// `user_id` comes from the path (`/:user_id`); spread last so a body value cannot
		// redirect the write to another user
		const data = this.validate(
			this.validator.create,
			{ ...req.body, user_id: req.params.user_id },
			res,
		);

		const results = await this.userPermissionService.create(data);

		res.locals.output.data(results);
		res.locals.output.message(lang('user-permission.success.update'));

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canGrant(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.userPermissionService.delete(
			data.user_id,
			data.permission_id,
		);

		res.locals.output.message(lang('user-permission.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canGrant(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.userPermissionService.restore(
			data.user_id,
			data.permission_id,
		);

		res.locals.output.message(lang('user-permission.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(
			this.validator.find,
			{
				...req.query,
				user_id: req.params.user_id,
			},
			res,
		);

		const [entries, total] = await this.userPermissionService.findByFilter(
			data,
			this.policy.allowDeleted(res.locals.auth),
			data.user_id,
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
}

export const userPermissionController = new UserPermissionController(
	permissionPolicy,
	new UserPermissionValidator('user-permission'),
	userPermissionService,
);
