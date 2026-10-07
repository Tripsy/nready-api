import { jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import { InvoiceStatusEnum } from '@/features/invoice/invoice.entity';
import {
	getInvoiceEntityMock,
	getInvoiceLineEntityMock,
	getInvoicePaymentEntityMock,
	invoiceInputPayloads,
} from '@/features/invoice/invoice.mock';
import { invoicePolicy } from '@/features/invoice/invoice.policy';
import invoiceRoutes from '@/features/invoice/invoice.routes';
import { invoiceService } from '@/features/invoice/invoice.service';
import type { InvoiceValidator } from '@/features/invoice/invoice.validator';
import { invoiceLineService } from '@/features/invoice/invoice-line.service';
import { invoicePaymentService } from '@/features/invoice/invoice-payment.service';
import { invoiceSettlementService } from '@/features/invoice/invoice-settlement.service';
import {
	testControllerCreate,
	testControllerFind,
	testControllerRead,
	testControllerStatusUpdate,
	testControllerUpdate,
	withDebugResponse,
} from '@/tests/jest-controller.setup';
import { authorizedSpy, notAuthorizedSpy } from '@/tests/mocks/policies.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(() => {
	jest.restoreAllMocks();

	// What runs after a write - settling the client's money, moving orders along - reads the
	// database across several features; it has its own tests in `order-settlement.test.ts`
	jest.spyOn(invoiceSettlementService, 'afterIssued').mockResolvedValue();
});

const controller = 'InvoiceController';
const basePath = (await invoiceRoutes()).basePath;
const entityMock = getInvoiceEntityMock();

testControllerCreate<InvoiceEntity, InvoiceValidator>({
	controller: controller,
	route: basePath,
	entityMock: entityMock,
	policy: invoicePolicy,
	service: invoiceService,
	createData: invoiceInputPayloads.create,
});

testControllerRead<InvoiceEntity>({
	controller: controller,
	route: `${basePath}/${entityMock.id}`,
	entityMock: entityMock,
	policy: invoicePolicy,
});

testControllerUpdate<InvoiceEntity, InvoiceValidator>({
	controller: controller,
	route: `${basePath}/${entityMock.id}`,
	entityMock: entityMock,
	policy: invoicePolicy,
	service: invoiceService,
	updateData: invoiceInputPayloads.update,
});

testControllerFind<InvoiceEntity, InvoiceValidator>({
	controller: controller,
	route: basePath,
	entityMock: entityMock,
	policy: invoicePolicy,
	service: invoiceService,
	findData: invoiceInputPayloads.find,
});

testControllerStatusUpdate<InvoiceEntity>({
	controller: controller,
	route: `${basePath}/${entityMock.id}/status/${InvoiceStatusEnum.ISSUED}`,
	entityMock: entityMock,
	policy: invoicePolicy,
	service: invoiceService,
});

/*
 * The actions beyond CRUD, which no shared builder covers: each carries the document id in its
 * path and delegates to a service of its own, so the standard triad is written out per action.
 */
describe(`${controller} - reverse`, () => {
	const route = `${basePath}/${entityMock.id}/reverse`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(invoicePolicy);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		const reversal = getInvoiceEntityMock({
			id: 2,
			is_reversal: true,
			parent_invoice_id: entityMock.id,
		});

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoiceService, 'createReversal').mockResolvedValue(
			reversal,
		);

		const response = await request(app)
			.post(route)
			.send({ lines: [{ invoice_line_id: 1, quantity: 1 }] });

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body.data).toHaveProperty('id', reversal.id);
		}, response);
	});
});

describe(`${controller} - lineCreate`, () => {
	const route = `${basePath}/${entityMock.id}/lines`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(invoicePolicy);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		const line = getInvoiceLineEntityMock();

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoiceLineService, 'create').mockResolvedValue(line);

		const response = await request(app)
			.post(route)
			.send(invoiceInputPayloads.lineCreate);

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body.data).toHaveProperty('id', line.id);
		}, response);
	});

	// The path id is merged into the body before validation; a body with no line fields is a
	// 422 rather than a line written from defaults
	it('should fail validation with an empty body', async () => {
		authorizedSpy(invoicePolicy);

		const response = await request(app).post(route).send({});

		withDebugResponse(() => {
			expect(response.status).toBe(422);
		}, response);
	});
});

describe(`${controller} - lineUpdate`, () => {
	const line = getInvoiceLineEntityMock();
	const route = `${basePath}/${entityMock.id}/lines/${line.id}`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).put(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoiceLineService, 'updateData').mockResolvedValue(line);

		const response = await request(app).put(route).send({ quantity: 3 });

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body.data).toHaveProperty('id', line.id);
		}, response);
	});
});

describe(`${controller} - lineDelete`, () => {
	const route = `${basePath}/${entityMock.id}/lines/${getInvoiceLineEntityMock().id}`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoiceLineService, 'delete').mockResolvedValue();

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
		}, response);
	});
});

describe(`${controller} - paymentCreate`, () => {
	const route = `${basePath}/${entityMock.id}/payments`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(invoicePolicy);

		const response = await request(app).post(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		const payment = getInvoicePaymentEntityMock();

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoicePaymentService, 'create').mockResolvedValue(payment);

		const response = await request(app)
			.post(route)
			.send({ cash_flow_id: 1, amount: 100 });

		withDebugResponse(() => {
			expect(response.status).toBe(201);
			expect(response.body.data).toHaveProperty('id', payment.id);
		}, response);
	});
});

describe(`${controller} - paymentClear`, () => {
	const route = `${basePath}/${entityMock.id}/payments`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		const clear = jest
			.spyOn(invoicePaymentService, 'clear')
			.mockResolvedValue(2);

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
			expect(clear).toHaveBeenCalledWith(entityMock);
		}, response);
	});
});

describe(`${controller} - paymentDelete`, () => {
	const route = `${basePath}/${entityMock.id}/payments/${getInvoicePaymentEntityMock().id}`;

	it('should fail if not authenticated', async () => {
		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it('should return success', async () => {
		authorizedSpy(invoicePolicy);

		jest.spyOn(invoiceService, 'findById').mockResolvedValue(entityMock);
		jest.spyOn(invoicePaymentService, 'delete').mockResolvedValue();

		const response = await request(app).delete(route).send();

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty('success', true);
		}, response);
	});
});
