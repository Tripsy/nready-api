import { jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type UserEntity from '@/features/user/user.entity';
import {
	getUserEntityMock,
	userInputPayloads,
} from '@/features/user/user.mock';
import { userPolicy } from '@/features/user/user.policy';
import userRoutes from '@/features/user/user.routes';
import { userService } from '@/features/user/user.service';
import type { UserValidator } from '@/features/user/user.validator';
import { UserRoleEnum } from '@/shared/types/user-role.type';
import {
	testControllerCreate,
	testControllerDeleteSingle,
	testControllerFind,
	testControllerRead,
	testControllerRestoreSingle,
	testControllerStatusUpdate,
	testControllerUpdate,
	withDebugResponse,
} from '@/tests/jest-controller.setup';
import { adminSpy, authorizedSpy } from '@/tests/mocks/policies.mock';

beforeEach(() => {
	jest.restoreAllMocks();
});

const controller = 'UserController';
const basePath = userRoutes.basePath;

testControllerCreate<UserEntity, UserValidator>({
	controller: controller,
	route: basePath,
	entityMock: getUserEntityMock(),
	policy: userPolicy,
	service: userService,
	createData: userInputPayloads.create,
});

testControllerUpdate<UserEntity, UserValidator>({
	controller: controller,
	route: `${basePath}/${getUserEntityMock().id}`,
	entityMock: getUserEntityMock(),
	policy: userPolicy,
	service: userService,
	updateData: userInputPayloads.update,
});

testControllerRead<UserEntity>({
	controller: controller,
	route: `${basePath}/${getUserEntityMock().id}`,
	entityMock: getUserEntityMock(),
	policy: userPolicy,
});

testControllerDeleteSingle({
	controller: controller,
	route: `${basePath}/${getUserEntityMock().id}`,
	policy: userPolicy,
	service: userService,
	arrangeSuccess: () => {
		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);
	},
});

testControllerRestoreSingle({
	controller: controller,
	route: `${basePath}/${getUserEntityMock().id}/restore`,
	policy: userPolicy,
	service: userService,
	arrangeSuccess: () => {
		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);
	},
});

testControllerFind<UserEntity, UserValidator>({
	controller: controller,
	route: basePath,
	entityMock: getUserEntityMock(),
	policy: userPolicy,
	service: userService,
	findData: userInputPayloads.find,
});

testControllerStatusUpdate<UserEntity>({
	controller: controller,
	route: `${basePath}/${getUserEntityMock().id}/status/active`,
	entityMock: getUserEntityMock(),
	policy: userPolicy,
	service: userService,
});

describe(`${controller} - role assignment`, () => {
	let app: Express;

	beforeAll(async () => {
		app = await createApp();
	});

	const updateRoute = `${basePath}/${getUserEntityMock().id}`;
	const promoted = { ...userInputPayloads.update, role: UserRoleEnum.ADMIN };

	it('should refuse an operator creating a non-member', async () => {
		authorizedSpy(userPolicy);

		const response = await request(app)
			.post(basePath)
			.send({ ...userInputPayloads.create, role: UserRoleEnum.ADMIN });

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should refuse an operator changing the role', async () => {
		authorizedSpy(userPolicy);

		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);
		const updateSpy = jest.spyOn(userService, 'updateData');

		const response = await request(app).put(updateRoute).send(promoted);

		withDebugResponse(() => {
			expect(response.status).toBe(403);
			expect(updateSpy).not.toHaveBeenCalled();
		}, response);
	});

	it('should let an admin change the role', async () => {
		adminSpy(userPolicy);

		jest.spyOn(userService, 'findById').mockResolvedValue(
			getUserEntityMock(),
		);
		jest.spyOn(userService, 'updateData').mockResolvedValue({
			...getUserEntityMock(),
			role: UserRoleEnum.ADMIN,
		});

		const response = await request(app).put(updateRoute).send(promoted);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
		}, response);
	});
});

describe(`${controller} - staff target`, () => {
	let app: Express;

	beforeAll(async () => {
		app = await createApp();
	});

	const route = `${basePath}/${getUserEntityMock().id}`;
	const adminEntry = { ...getUserEntityMock(), role: UserRoleEnum.ADMIN };

	const writes = [
		{
			name: 'update',
			send: () => request(app).put(route).send(userInputPayloads.update),
			serviceMethod: 'updateData',
		},
		{
			name: 'statusUpdate',
			send: () => request(app).patch(`${route}/status/active`).send(),
			serviceMethod: 'updateStatus',
		},
		{
			name: 'delete',
			send: () => request(app).delete(route).send(),
			serviceMethod: 'delete',
		},
		{
			name: 'restore',
			send: () => request(app).patch(`${route}/restore`).send(),
			serviceMethod: 'restore',
		},
	] as const;

	const operatorEntry = {
		...getUserEntityMock(),
		role: UserRoleEnum.OPERATOR,
		operator_type: 'seller' as const,
	};

	const targets = [
		{ label: 'an admin', entry: adminEntry },
		{ label: 'an operator', entry: operatorEntry },
	];

	it.each(
		writes.flatMap((write) =>
			targets.map((target) => ({ ...write, ...target })),
		),
	)(
		'should refuse an operator on $name of $label',
		async ({ send, serviceMethod, entry }) => {
			authorizedSpy(userPolicy);

			jest.spyOn(userService, 'findById').mockResolvedValue(entry);
			const writeSpy = jest.spyOn(userService, serviceMethod);

			const response = await send();

			withDebugResponse(() => {
				expect(response.status).toBe(403);
				expect(writeSpy).not.toHaveBeenCalled();
			}, response);
		},
	);

	it('should let an admin update another admin', async () => {
		adminSpy(userPolicy);

		jest.spyOn(userService, 'findById').mockResolvedValue(adminEntry);
		jest.spyOn(userService, 'updateData').mockResolvedValue(adminEntry);

		const response = await request(app)
			.put(route)
			.send({ ...userInputPayloads.update, role: UserRoleEnum.ADMIN });

		withDebugResponse(() => {
			expect(response.status).toBe(200);
		}, response);
	});
});
