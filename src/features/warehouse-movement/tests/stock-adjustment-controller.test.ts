import { expect, jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type StockAdjustmentEntity from '@/features/warehouse-movement/stock-adjustment.entity';
import {
	getStockAdjustmentEntityMock,
	stockAdjustmentInputPayloads,
} from '@/features/warehouse-movement/stock-adjustment.mock';
import { stockAdjustmentPolicy } from '@/features/warehouse-movement/stock-adjustment.policy';
import stockAdjustmentRoutes from '@/features/warehouse-movement/stock-adjustment.routes';
import { stockAdjustmentService } from '@/features/warehouse-movement/stock-adjustment.service';
import type { StockAdjustmentValidator } from '@/features/warehouse-movement/stock-adjustment.validator';
import {
	testControllerFind,
	withDebugResponse,
} from '@/tests/jest-controller.setup';
import {
	authorizedSpy,
	notAuthenticatedSpy,
	notAuthorizedSpy,
} from '@/tests/mocks/policies.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(() => {
	jest.restoreAllMocks();
});

const controller = 'StockAdjustmentController';
const basePath = (await stockAdjustmentRoutes()).basePath;
const entityMock = getStockAdjustmentEntityMock();
const entryWithMovements = Object.assign(getStockAdjustmentEntityMock(), {
	movements: [],
});

testControllerFind<StockAdjustmentEntity, StockAdjustmentValidator>({
	controller: controller,
	route: basePath,
	entityMock: entityMock,
	policy: stockAdjustmentPolicy,
	service: stockAdjustmentService,
	findData: stockAdjustmentInputPayloads.find,
});

describe(`${controller} - create`, () => {
	it('should fail if not authenticated', async () => {
		notAuthenticatedSpy(stockAdjustmentPolicy);

		const response = await request(app)
			.post(basePath)
			.send(stockAdjustmentInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(stockAdjustmentPolicy);

		const response = await request(app)
			.post(basePath)
			.send(stockAdjustmentInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(stockAdjustmentPolicy);

		const create = jest
			.spyOn(stockAdjustmentService, 'create')
			.mockResolvedValue(entryWithMovements);

		const response = await request(app)
			.post(basePath)
			.send(stockAdjustmentInputPayloads.create);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data).toHaveProperty('id', entityMock.id);
			expect(create).toHaveBeenCalledWith(
				expect.objectContaining({
					qty: 12,
					direction: 'remove',
					warehouse_id: 1,
				}),
			);
		}, response);
	});

	it('should fail validation when the reason does not fit the direction', async () => {
		authorizedSpy(stockAdjustmentPolicy);

		const response = await request(app)
			.post(basePath)
			.send({ ...stockAdjustmentInputPayloads.create, direction: 'add' });

		withDebugResponse(() => {
			expect(response.status).toBe(422);
		}, response);
	});
});

describe(`${controller} - reverse`, () => {
	const route = `${basePath}/${entityMock.id}/reverse`;

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(stockAdjustmentPolicy);

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(stockAdjustmentPolicy);

		const reverse = jest
			.spyOn(stockAdjustmentService, 'reverse')
			.mockResolvedValue(entryWithMovements);

		const response = await request(app).patch(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(reverse).toHaveBeenCalledWith(entityMock.id);
		}, response);
	});
});

describe(`${controller} - read`, () => {
	it('should return success', async () => {
		authorizedSpy(stockAdjustmentPolicy);

		jest.spyOn(stockAdjustmentService, 'findById').mockResolvedValue(
			entryWithMovements,
		);

		const response = await request(app).get(`${basePath}/${entityMock.id}`);

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data).toHaveProperty('movements');
		}, response);
	});
});
