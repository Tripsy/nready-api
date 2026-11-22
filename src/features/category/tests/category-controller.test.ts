import { expect, jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type CategoryEntity from '@/features/category/category.entity';
import {
	categoryInputPayloads,
	getCategoryEntityMock,
} from '@/features/category/category.mock';
import { categoryPolicy } from '@/features/category/category.policy';
import categoryRoutes from '@/features/category/category.routes';
import { categoryService } from '@/features/category/category.service';
import type { CategoryValidator } from '@/features/category/category.validator';
import {
	testControllerCreate,
	testControllerDeleteSingle,
	testControllerFind,
	testControllerRead,
	testControllerRestoreSingle,
	testControllerStatusUpdate,
	testControllerUpdateWithContent,
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

const controller = 'CategoryController';
const basePath = (await categoryRoutes()).basePath;

testControllerCreate<CategoryEntity, CategoryValidator>({
	controller: controller,
	route: basePath,
	entityMock: getCategoryEntityMock(),
	policy: categoryPolicy,
	service: categoryService,
	createData: categoryInputPayloads.create,
});

testControllerUpdateWithContent<CategoryEntity, CategoryValidator>({
	controller: controller,
	route: `${basePath}/${getCategoryEntityMock().id}`,
	entityMock: getCategoryEntityMock(),
	policy: categoryPolicy,
	service: categoryService,
	updateData: categoryInputPayloads.update,
	mockLoadEntry: (entityMock) => {
		jest.spyOn(categoryService, 'findByIdWithParent').mockResolvedValue(
			entityMock,
		);
	},
});

testControllerRead<CategoryEntity>({
	controller: controller,
	route: `${basePath}/${getCategoryEntityMock().id}`,
	entityMock: getCategoryEntityMock(),
	policy: categoryPolicy,
});

testControllerDeleteSingle({
	controller: controller,
	route: `${basePath}/${getCategoryEntityMock().id}`,
	policy: categoryPolicy,
	service: categoryService,
});

testControllerRestoreSingle({
	controller: controller,
	route: `${basePath}/${getCategoryEntityMock().id}/restore`,
	policy: categoryPolicy,
	service: categoryService,
});

testControllerFind<CategoryEntity, CategoryValidator>({
	controller: controller,
	route: basePath,
	entityMock: getCategoryEntityMock(),
	policy: categoryPolicy,
	service: categoryService,
	findData: categoryInputPayloads.find,
});

testControllerStatusUpdate<CategoryEntity>({
	controller: controller,
	route: `${basePath}/${getCategoryEntityMock().id}/status/active`,
	entityMock: getCategoryEntityMock(),
	policy: categoryPolicy,
	service: categoryService,
});

describe(`${controller} - orderUpdate`, () => {
	const route = `${basePath}/${categoryInputPayloads.orderUpdate.type}/order`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(categoryPolicy);

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(categoryPolicy);

		const updateOrder = jest
			.spyOn(categoryService, 'updateOrder')
			.mockResolvedValue();

		const response = await request(app)
			.patch(route)
			.send(categoryInputPayloads.orderUpdate);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
		}, response);

		expect(updateOrder).toHaveBeenCalledWith(
			categoryInputPayloads.orderUpdate.type,
			categoryInputPayloads.orderUpdate.parent_id,
			categoryInputPayloads.orderUpdate.positions,
		);
	});

	// `validateParamsWhenEnum` runs as route middleware and throws `BadRequestError`, so
	// this fails with 400 rather than the 422 a schema failure would produce.
	it('should reject a type outside the enum before reaching the controller', async () => {
		authorizedSpy(categoryPolicy);

		const response = await request(app)
			.patch(`${basePath}/nonsense/order`)
			.send(categoryInputPayloads.orderUpdate);

		withDebugResponse(() => {
			expect(response.status).toBe(400);
		}, response);
	});

	it('should reject fewer than two positions', async () => {
		authorizedSpy(categoryPolicy);

		const response = await request(app)
			.patch(route)
			.send({
				...categoryInputPayloads.orderUpdate,
				positions: [mockId(3)],
			});

		withDebugResponse(() => {
			expect(response.status).toBe(422);
		}, response);
	});
});
