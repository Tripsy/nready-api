import { jest } from '@jest/globals';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import ProductEntity from '@/features/product/product.entity';
import type ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import { ProductCategoryAttributeScopeEnum } from '@/features/product/product-category-attribute.entity';
import {
	getProductCategoryAttributeEntityMock,
	productCategoryAttributeInputPayloads,
} from '@/features/product/product-category-attribute.mock';
import { productCategoryAttributePolicy } from '@/features/product/product-category-attribute.policy';
import productCategoryAttributeRoutes from '@/features/product/product-category-attribute.routes';
import { productCategoryAttributeService } from '@/features/product/product-category-attribute.service';
import type { ProductCategoryAttributeValidator } from '@/features/product/product-category-attribute.validator';
import {
	testControllerCreate,
	testControllerDeleteSingle,
	testControllerFind,
	testControllerRead,
	testControllerRestoreSingle,
	testControllerUpdate,
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

const controller = 'ProductCategoryAttributeController';
const basePath = (await productCategoryAttributeRoutes()).basePath;
const entityId = getProductCategoryAttributeEntityMock().id;

testControllerCreate<
	ProductCategoryAttributeEntity,
	ProductCategoryAttributeValidator
>({
	controller: controller,
	route: basePath,
	entityMock: getProductCategoryAttributeEntityMock(),
	policy: productCategoryAttributePolicy,
	service: productCategoryAttributeService,
	createData: productCategoryAttributeInputPayloads.create,
});

testControllerUpdate<
	ProductCategoryAttributeEntity,
	ProductCategoryAttributeValidator
>({
	controller: controller,
	route: `${basePath}/${entityId}`,
	entityMock: getProductCategoryAttributeEntityMock(),
	policy: productCategoryAttributePolicy,
	service: productCategoryAttributeService,
	updateData: productCategoryAttributeInputPayloads.update,
});

testControllerRead<ProductCategoryAttributeEntity>({
	controller: controller,
	route: `${basePath}/${entityId}`,
	entityMock: getProductCategoryAttributeEntityMock(),
	policy: productCategoryAttributePolicy,
});

testControllerDeleteSingle({
	controller: controller,
	route: `${basePath}/${entityId}`,
	policy: productCategoryAttributePolicy,
	service: productCategoryAttributeService,
});

testControllerRestoreSingle({
	controller: controller,
	route: `${basePath}/${entityId}/restore`,
	policy: productCategoryAttributePolicy,
	service: productCategoryAttributeService,
});

testControllerFind<
	ProductCategoryAttributeEntity,
	ProductCategoryAttributeValidator
>({
	controller: controller,
	route: basePath,
	entityMock: getProductCategoryAttributeEntityMock(),
	policy: productCategoryAttributePolicy,
	service: productCategoryAttributeService,
	findData: productCategoryAttributeInputPayloads.find,
});

describe(`${controller} - resolve`, () => {
	const route = `${basePath}/resolve`;

	const form = {
		[ProductCategoryAttributeScopeEnum.PRODUCT]: [
			getProductCategoryAttributeEntityMock(),
		],
		[ProductCategoryAttributeScopeEnum.VARIANT]: [],
	};

	it('should fail if not authenticated', async () => {
		const response = await request(app).get(route).query({});

		withDebugResponse(() => {
			expect(response.status).toBe(401);
		}, response);
	});

	it("should fail if it doesn't have proper permission", async () => {
		notAuthorizedSpy(productCategoryAttributePolicy);

		const response = await request(app).get(route).query({});

		withDebugResponse(() => {
			expect(response.status).toBe(403);
		}, response);
	});

	it('should return the form split by scope', async () => {
		authorizedSpy(productCategoryAttributePolicy);

		jest.spyOn(
			productCategoryAttributeService,
			'resolveForm',
		).mockResolvedValue(form);

		const response = await request(app)
			.get(route)
			.query({ category_id: [mockId(1), mockId(5)] });

		withDebugResponse(() => {
			expect(response.status).toBe(200);
			expect(
				productCategoryAttributeService.resolveForm,
			).toHaveBeenCalledWith([mockId(1), mockId(5)]);
			expect(response.body.data).toHaveProperty(
				ProductCategoryAttributeScopeEnum.VARIANT,
			);
		}, response);
	});

	it('should reject a call naming no category', async () => {
		authorizedSpy(productCategoryAttributePolicy);

		const response = await request(app).get(route).query({});

		withDebugResponse(() => {
			expect(response.status).toBe(422);
		}, response);
	});

	/*
	 * The literal has to be registered ahead of `/:id`, or Express matches it against the id
	 * parameter and the route-level guard rejects it before this handler is ever reached.
	 */
	it('is registered ahead of the :id route', async () => {
		const routes = (await productCategoryAttributeRoutes()).routes;
		const order = Object.keys(routes);

		expect(order.indexOf('resolve')).toBeLessThan(order.indexOf('read'));
	});
});

/*
 * The permission gate is the containing folder, not the file name: a definition declares what a
 * product must say about itself, so anyone who may edit the catalog may edit its schema. A
 * separate permission entry would be a second switch nobody remembers to grant.
 */
describe(`${controller} - permission gate`, () => {
	it('is gated on the product entity', () => {
		expect(productCategoryAttributePolicy.entity).toBe(ProductEntity.NAME);
	});
});
