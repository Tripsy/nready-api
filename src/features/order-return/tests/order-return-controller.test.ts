import { expect, jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type OrderReturnEntity from '@/features/order-return/order-return.entity';
import { OrderReturnStatusEnum } from '@/features/order-return/order-return.entity';
import {
	getOrderReturnEntityMock,
	orderReturnInputPayloads,
} from '@/features/order-return/order-return.mock';
import { orderReturnPolicy } from '@/features/order-return/order-return.policy';
import orderReturnRoutes from '@/features/order-return/order-return.routes';
import { orderReturnService } from '@/features/order-return/order-return.service';
import type { OrderReturnValidator } from '@/features/order-return/order-return.validator';
import orderReturnPublicRoutes from '@/features/order-return/order-return-public.routes';
import {
	testControllerCreate,
	testControllerDeleteSingle,
	testControllerFind,
	testControllerRead,
	testControllerRestoreSingle,
	testControllerUpdate,
	withDebugResponse,
} from '@/tests/jest-controller.setup';
import {
	authorizedSpy,
	isAuthenticatedSpy,
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

const controller = 'OrderReturnController';
const basePath = (await orderReturnRoutes()).basePath;
const publicBasePath = (await orderReturnPublicRoutes()).basePath;
const entityMock = getOrderReturnEntityMock();

testControllerCreate<OrderReturnEntity, OrderReturnValidator>({
	controller: controller,
	route: basePath,
	entityMock: entityMock,
	policy: orderReturnPolicy,
	service: orderReturnService,
	createData: orderReturnInputPayloads.create,
});

testControllerRead<OrderReturnEntity>({
	controller: controller,
	route: `${basePath}/${entityMock.id}`,
	entityMock: entityMock,
	policy: orderReturnPolicy,
});

testControllerUpdate<OrderReturnEntity, OrderReturnValidator>({
	controller: controller,
	route: `${basePath}/${entityMock.id}`,
	entityMock: entityMock,
	policy: orderReturnPolicy,
	service: orderReturnService,
	updateData: orderReturnInputPayloads.update,
});

testControllerDeleteSingle({
	controller: controller,
	route: `${basePath}/${entityMock.id}`,
	policy: orderReturnPolicy,
	service: orderReturnService,
});

testControllerRestoreSingle({
	controller: controller,
	route: `${basePath}/${entityMock.id}/restore`,
	policy: orderReturnPolicy,
	service: orderReturnService,
});

testControllerFind<OrderReturnEntity, OrderReturnValidator>({
	controller: controller,
	route: basePath,
	entityMock: entityMock,
	policy: orderReturnPolicy,
	service: orderReturnService,
	findData: orderReturnInputPayloads.find,
});

describe(`${controller} - approve`, () => {
	const route = `${basePath}/${entityMock.id}/approve`;

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(orderReturnPolicy);

		const response = await request(app).post(route).send({});

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should refuse a price without its VAT rate', async () => {
		authorizedSpy(orderReturnPolicy);

		const approve = jest.spyOn(orderReturnService, 'approve');

		const response = await request(app).post(route).send({ price: 20 });

		withDebugResponse(() => {
			expect(response.status).toBe(422);
			expect(approve).not.toHaveBeenCalled();
		}, response);
	});

	it('should hand the id from the path and the fee decision to the service', async () => {
		authorizedSpy(orderReturnPolicy);

		jest.spyOn(orderReturnService, 'findById').mockResolvedValue(
			entityMock,
		);
		const approve = jest
			.spyOn(orderReturnService, 'approve')
			.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.APPROVED,
					shipping_id: 64,
					refund_shipping: true,
				}),
			);

		const response = await request(app)
			.post(route)
			.send({ carrier_id: 3, refund_shipping: true });

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data).toMatchObject({
				status: OrderReturnStatusEnum.APPROVED,
				refund_shipping: true,
			});
			expect(approve).toHaveBeenCalledWith(
				entityMock,
				expect.objectContaining({
					id: entityMock.id,
					carrier_id: 3,
					refund_shipping: true,
				}),
			);
		}, response);
	});
});

describe(`${controller} - refund`, () => {
	const route = `${basePath}/${entityMock.id}/refund`;

	it('should answer 409 when there was nothing to reverse', async () => {
		authorizedSpy(orderReturnPolicy);

		jest.spyOn(orderReturnService, 'draftRefund').mockResolvedValue([]);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(409);
		}, response);
	});

	it('should return the drafted reversals', async () => {
		authorizedSpy(orderReturnPolicy);

		jest.spyOn(orderReturnService, 'draftRefund').mockResolvedValue([
			212, 213,
		]);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data).toEqual({
				reversal_invoice_ids: [212, 213],
			});
		}, response);
	});
});

describe(`${controller} - statusUpdate`, () => {
	it('should not take approved through the status route', async () => {
		authorizedSpy(orderReturnPolicy);

		const updateStatus = jest.spyOn(orderReturnService, 'updateStatus');

		const response = await request(app)
			.patch(
				`${basePath}/${entityMock.id}/status/${OrderReturnStatusEnum.APPROVED}`,
			)
			.send();

		withDebugResponse(() => {
			expect(response.status).not.toBe(200);
			expect(updateStatus).not.toHaveBeenCalled();
		}, response);
	});

	it('should pass the response along with a rejection', async () => {
		authorizedSpy(orderReturnPolicy);

		jest.spyOn(orderReturnService, 'findById').mockResolvedValue(
			entityMock,
		);
		const updateStatus = jest
			.spyOn(orderReturnService, 'updateStatus')
			.mockResolvedValue();

		const response = await request(app)
			.patch(
				`${basePath}/${entityMock.id}/status/${OrderReturnStatusEnum.REJECTED}`,
			)
			.send({ response: 'Outside the return window' });

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(updateStatus).toHaveBeenCalledWith(
				entityMock,
				OrderReturnStatusEnum.REJECTED,
				'Outside the return window',
			);
		}, response);
	});
});

describe('OrderReturnPublicController', () => {
	const orderId = 118;
	const userId = 42;

	const signedIn = () => {
		isAuthenticatedSpy(orderReturnPolicy);
		jest.spyOn(orderReturnPolicy, 'getId').mockReturnValue(userId);
	};

	it('should require a session', async () => {
		notAuthenticatedSpy(orderReturnPolicy);

		const response = await request(app)
			.get(`${publicBasePath}/orders/${orderId}/returns`)
			.send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should list the caller's returns on their order", async () => {
		signedIn();

		const findForOwnOrder = jest
			.spyOn(orderReturnService, 'findForOwnOrder')
			.mockResolvedValue([{ ...entityMock, lines: [] }]);

		const response = await request(app)
			.get(`${publicBasePath}/orders/${orderId}/returns`)
			.send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data.entries).toHaveLength(1);
			expect(findForOwnOrder).toHaveBeenCalledWith(orderId, userId);
		}, response);
	});

	// The order comes from the path, spread last - a body naming another order cannot redirect it
	it('should request a return against the order in the path', async () => {
		signedIn();

		const createOwn = jest
			.spyOn(orderReturnService, 'createOwn')
			.mockResolvedValue(entityMock);

		const response = await request(app)
			.post(`${publicBasePath}/orders/${orderId}/returns`)
			.send({ ...orderReturnInputPayloads.publicCreate, order_id: 999 });

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body.data).toEqual({
				id: entityMock.id,
				ref_code: entityMock.ref_code,
				ref_number: entityMock.ref_number,
				status: entityMock.status,
			});
			expect(createOwn).toHaveBeenCalledWith(
				expect.objectContaining({ order_id: orderId }),
				userId,
			);
		}, response);
	});

	it('should refuse a request with no lines', async () => {
		signedIn();

		const createOwn = jest.spyOn(orderReturnService, 'createOwn');

		const response = await request(app)
			.post(`${publicBasePath}/orders/${orderId}/returns`)
			.send({ ...orderReturnInputPayloads.publicCreate, lines: [] });

		withDebugResponse(() => {
			expect(response.status).toBe(422);
			expect(createOwn).not.toHaveBeenCalled();
		}, response);
	});

	it('should withdraw a request', async () => {
		signedIn();

		const cancelOwn = jest
			.spyOn(orderReturnService, 'cancelOwn')
			.mockResolvedValue();

		const response = await request(app)
			.patch(
				`${publicBasePath}/orders/${orderId}/returns/${entityMock.id}/cancel`,
			)
			.send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(cancelOwn).toHaveBeenCalledWith(
				orderId,
				entityMock.id,
				userId,
			);
		}, response);
	});
});
