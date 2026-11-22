import { jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type PermissionEntity from '@/features/permission/permission.entity';
import {
	getPermissionEntityMock,
	permissionInputPayloads,
} from '@/features/permission/permission.mock';
import { permissionPolicy } from '@/features/permission/permission.policy';
import permissionRoutes from '@/features/permission/permission.routes';
import { permissionService } from '@/features/permission/permission.service';
import type { PermissionValidator } from '@/features/permission/permission.validator';
import {
	testControllerDeleteSingle,
	testControllerFind,
	testControllerRead,
	testControllerRestoreSingle,
	withDebugResponse,
} from '@/tests/jest-controller.setup';
import { authorizedSpy, notAuthorizedSpy } from '@/tests/mocks/policies.mock';
import { mockId } from '@/tests/mocks/uuid.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(() => {
	jest.restoreAllMocks();
});

const controller = 'PermissionController';
const basePath = (await permissionRoutes()).basePath;

describe(`${controller} - create`, () => {
	const route = basePath;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(permissionPolicy);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(permissionPolicy);

		jest.spyOn(permissionService, 'create').mockResolvedValue({
			permission: getPermissionEntityMock(),
			action: 'create',
		});

		const response = await request(app)
			.post(route)
			.send(permissionInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body.data).toHaveProperty(
				'id',
				getPermissionEntityMock().id,
			);
		}, response);
	});
});

describe(`${controller} - update`, () => {
	const route = `${basePath}/${mockId(1)}`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).put(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(permissionPolicy);

		const response = await request(app).put(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(permissionPolicy);

		jest.spyOn(permissionService, 'findById').mockResolvedValue(
			getPermissionEntityMock(),
		);

		jest.spyOn(permissionService, 'updateData').mockResolvedValue(
			getPermissionEntityMock(),
		);

		const response = await request(app)
			.put(route)
			.send(permissionInputPayloads.update);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body.data).toHaveProperty(
				'id',
				getPermissionEntityMock().id,
			);
		}, response);
	});
});

testControllerRead<PermissionEntity>({
	controller: controller,
	route: `${basePath}/${getPermissionEntityMock().id}`,
	entityMock: getPermissionEntityMock(),
	policy: permissionPolicy,
});

testControllerDeleteSingle({
	controller: controller,
	route: `${basePath}/${getPermissionEntityMock().id}`,
	policy: permissionPolicy,
	service: permissionService,
});

testControllerRestoreSingle({
	controller: controller,
	route: `${basePath}/${getPermissionEntityMock().id}/restore`,
	policy: permissionPolicy,
	service: permissionService,
});

testControllerFind<PermissionEntity, PermissionValidator>({
	controller: controller,
	route: basePath,
	entityMock: getPermissionEntityMock(),
	policy: permissionPolicy,
	service: permissionService,
	findData: permissionInputPayloads.find,
});
