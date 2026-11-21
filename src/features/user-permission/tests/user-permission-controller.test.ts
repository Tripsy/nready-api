import { jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import { getPermissionEntityMock } from '@/features/permission/permission.mock';
import { permissionPolicy } from '@/features/permission/permission.policy';
import { getUserEntityMock } from '@/features/user/user.mock';
import {
	getUserPermissionEntityMock,
	userPermissionInputPayloads,
} from '@/features/user-permission/user-permission.mock';
import userPermissionRoutes from '@/features/user-permission/user-permission.routes';
import { userPermissionService } from '@/features/user-permission/user-permission.service';
import { withDebugResponse } from '@/tests/jest-controller.setup';
import {
	adminSpy,
	authorizedSpy,
	notAuthorizedSpy,
} from '@/tests/mocks/policies.mock';
import { mockId } from '@/tests/mocks/uuid.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(() => {
	jest.restoreAllMocks();
});

const controller = 'UserPermissionController';
const basePath = (await userPermissionRoutes()).basePath;

describe(`${controller} - create`, () => {
	const route = `${basePath}/${getUserEntityMock().id}`;

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

	it('should fail for an operator holding the permission', async () => {
		authorizedSpy(permissionPolicy);

		const response = await request(app)
			.post(route)
			.send(userPermissionInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		adminSpy(permissionPolicy);

		jest.spyOn(userPermissionService, 'create').mockResolvedValue([
			{ permission_id: mockId(1), message: 'created' },
			{ permission_id: mockId(2), message: 'created' },
		]);

		const response = await request(app)
			.post(route)
			.send(userPermissionInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(response.body.data).toHaveLength(2);
		}, response);
	});
});

describe(`${controller} - delete`, () => {
	const route = `${basePath}/${getUserEntityMock().id}/${getPermissionEntityMock().id}`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(permissionPolicy);

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should fail for an operator holding the permission', async () => {
		authorizedSpy(permissionPolicy);

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		adminSpy(permissionPolicy);

		jest.spyOn(userPermissionService, 'delete').mockResolvedValue();

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
		}, response);
	});
});

describe(`${controller} - restore`, () => {
	const route = `${basePath}/${getUserEntityMock().id}/${getPermissionEntityMock().id}/restore`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(permissionPolicy);

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should fail for an operator holding the permission', async () => {
		authorizedSpy(permissionPolicy);

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		adminSpy(permissionPolicy);

		jest.spyOn(userPermissionService, 'restore').mockResolvedValue();

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
		}, response);
	});
});

describe(`${controller} - find`, () => {
	const route = `${basePath}/${getUserEntityMock().id}`;

	it('should return success', async () => {
		authorizedSpy(permissionPolicy);

		jest.spyOn(userPermissionService, 'findByFilter').mockResolvedValue([
			[getUserPermissionEntityMock()],
			1,
		]);

		const response = await request(app)
			.get(route)
			.query(userPermissionInputPayloads.find);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data.entries).toHaveLength(1);
		}, response);
	});
});
