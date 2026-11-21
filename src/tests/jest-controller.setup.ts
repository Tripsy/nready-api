import { jest } from '@jest/globals';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import type { z } from 'zod';
import { createApp } from '@/app';
import { cacheProvider } from '@/providers/cache.provider';
import type PolicyAbstract from '@/shared/abstracts/policy.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorInput, ValidatorOutput } from '@/shared/types/mock.type';
import {
	authorizedSpy,
	notAuthenticatedSpy,
	notAuthorizedSpy,
} from '@/tests/mocks/policies.mock';
import { mockId } from '@/tests/mocks/uuid.mock';

let app: Express;

beforeAll(async () => {
	app = await createApp();
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(async () => {
	jest.clearAllMocks();
	jest.resetModules();
});

function addDebugResponse(response: Response, hint: string) {
	console.debug(hint, response.body);
}

export function withDebugResponse<T>(testFn: () => T, response: Response): T {
	try {
		return testFn();
	} catch (error) {
		// Get current test info from Jest
		const testName = expect.getState().currentTestName;

		addDebugResponse(response, testName ?? '');

		throw error;
	}
}

// Controller test - Create
export type CreateValidator = {
	create: z.ZodTypeAny;
};

type CreateService<E, V extends CreateValidator> = {
	/*
	 * The rest parameter covers a service that is handed something the payload does not carry -
	 * `ArticleService.create` takes the session account for `author_id`. The tests only ever
	 * spy on this method, so the extra arguments need to be admitted, not described.
	 */
	create(data: ValidatorOutput<V, 'create'>, ...rest: unknown[]): Promise<E>;
};

type ControllerCreateType<E, V extends CreateValidator> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
	service: CreateService<E, V>;
	createData: ValidatorInput<V, 'create'>;
};

export function testControllerCreate<E, V extends CreateValidator>(
	config: ControllerCreateType<E, V>,
) {
	describe(`${config.controller} - create`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).post(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).post(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			jest.spyOn(config.service, 'create').mockResolvedValue(
				config.entityMock,
			);

			const response = await request(app)
				.post(config.route)
				.send(config.createData as object);

			withDebugResponse(() => {
				expect(response.status).toBe(201);
				expect(response.body).toHaveProperty('success', true);
				expect(response.body.data).toHaveProperty(
					'id',
					config.entityMock.id,
				);
			}, response);
		});
	});
}

// Controller test - Read
type ControllerReadType<E> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
};

export function testControllerRead<E>(config: ControllerReadType<E>) {
	describe(`${config.controller} - read`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).get(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).get(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			jest.spyOn(cacheProvider, 'get').mockImplementation(
				async (_key, _fallback) => {
					return {
						isCached: false,
						data: config.entityMock,
					};
				},
			);

			const response = await request(app).get(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(200);
				expect(response.body).toHaveProperty('success', true);
				expect(response.body.data).toHaveProperty(
					'id',
					config.entityMock.id,
				);
			}, response);
		});
	});
}

// Controller test - Update
export type UpdateValidator = {
	update: z.ZodTypeAny;
};

type UpdateService<E, V extends UpdateValidator> = {
	// Update actions load the entity before mutating it, so the builder has to stub
	// `findById` too - otherwise it reaches the real repository, and the data source is
	// never initialized under `test` ("No metadata for <Entity> was found").
	findById(id: EntityId, withDeleted?: boolean): Promise<E>;
	updateData(
		entry: E,
		data: ValidatorOutput<V, 'update'>,
	): Promise<Partial<E>>;
};

type ControllerUpdateType<E, V extends UpdateValidator> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
	service: UpdateService<E, V>;
	updateData: ValidatorInput<V, 'update'>;
};

export function testControllerUpdate<E, V extends UpdateValidator>(
	config: ControllerUpdateType<E, V>,
) {
	describe(`${config.controller} - update`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).put(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).put(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			jest.spyOn(config.service, 'findById').mockResolvedValue(
				config.entityMock,
			);

			jest.spyOn(config.service, 'updateData').mockResolvedValue(
				config.entityMock,
			);

			const response = await request(app)
				.put(config.route)
				.send(config.updateData as object);

			withDebugResponse(() => {
				expect(response.status).toBe(200);
				expect(response.body).toHaveProperty('success', true);
				expect(response.body.data).toHaveProperty(
					'id',
					config.entityMock.id,
				);
			}, response);
		});
	});
}

type UpdateWithContentService<E, V extends UpdateValidator> = {
	findById(id: EntityId, withDeleted?: boolean): Promise<E>;
	updateDataWithContent(
		entry: E,
		data: ValidatorOutput<V, 'update'>,
	): Promise<Partial<E>>;
};

type ControllerUpdateWithContentType<E, V extends UpdateValidator> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
	service: UpdateWithContentService<E, V>;
	updateData: ValidatorInput<V, 'update'>;
	/**
	 * The controller loads the row before handing it to the service, and the loader differs
	 * per feature - `category` needs one that joins the `parent` relation. Only the caller
	 * knows which, so it may replace the default `findById` mock; leaving the real method
	 * behind reaches the repository, and the data source is not up in these tests.
	 */
	mockLoadEntry?: (entityMock: E) => void;
};

export function testControllerUpdateWithContent<E, V extends UpdateValidator>(
	config: ControllerUpdateWithContentType<E, V>,
) {
	describe(`${config.controller} - update`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).put(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).put(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			if (config.mockLoadEntry) {
				config.mockLoadEntry(config.entityMock);
			} else {
				jest.spyOn(config.service, 'findById').mockResolvedValue(
					config.entityMock,
				);
			}

			jest.spyOn(
				config.service,
				'updateDataWithContent',
			).mockResolvedValue(config.entityMock);

			const response = await request(app)
				.put(config.route)
				.send(config.updateData as object);

			withDebugResponse(() => {
				expect(response.status).toBe(200);
				expect(response.body).toHaveProperty('success', true);
				expect(response.body.data).toHaveProperty(
					'id',
					config.entityMock.id,
				);
			}, response);
		});
	});
}

// Controller test - Delete
export type DeleteValidator = {
	delete: z.ZodTypeAny;
};

type DeleteMultipleService<V extends DeleteValidator> = {
	delete(data: ValidatorOutput<V, 'delete'>): Promise<number>;
};

type ControllerDeleteMultipleType<V extends DeleteValidator> = {
	controller: string;
	route: string;
	policy: PolicyAbstract;
	service: DeleteMultipleService<V>;
};

export function testControllerDeleteMultiple<V extends DeleteValidator>(
	config: ControllerDeleteMultipleType<V>,
) {
	describe(`${config.controller} - delete`, () => {
		const testData = {
			ids: [mockId(3), mockId(4)],
		};

		it('should fail if not authenticated', async () => {
			notAuthenticatedSpy(config.policy);

			const response = await request(app).delete(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).delete(config.route).send();

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			jest.spyOn(config.service, 'delete').mockResolvedValue(3);

			const response = await request(app)
				.delete(config.route)
				.send(testData);

			withDebugResponse(() => {
				expect(response.status).toBe(200);
			}, response);
		});
	});
}

type DeleteSingleService = {
	delete(id: EntityId): Promise<void>;
};

type ControllerDeleteSingleType = {
	controller: string;
	route: string;
	policy: PolicyAbstract;
	service: DeleteSingleService;
	/** Spies the success case needs beyond the write itself - e.g. a controller that loads the row first. */
	arrangeSuccess?: () => void;
};

export function testControllerDeleteSingle(config: ControllerDeleteSingleType) {
	describe(`${config.controller} - delete`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).delete(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).delete(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);
			config.arrangeSuccess?.();

			jest.spyOn(config.service, 'delete').mockResolvedValue();

			const response = await request(app).delete(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(200);
			}, response);
		});
	});
}

// Controller test - Restore
type RestoreSingleService = {
	restore(id: EntityId): Promise<void>;
};

type ControllerRestoreSingleType = {
	controller: string;
	route: string;
	policy: PolicyAbstract;
	service: RestoreSingleService;
	/** Spies the success case needs beyond the write itself - e.g. a controller that loads the row first. */
	arrangeSuccess?: () => void;
};

export function testControllerRestoreSingle(
	config: ControllerRestoreSingleType,
) {
	describe(`${config.controller} - restore`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);
			config.arrangeSuccess?.();

			jest.spyOn(config.service, 'restore').mockResolvedValue();

			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(200);
			}, response);
		});
	});
}

export type FindValidator = {
	// find: z.ZodObject<z.ZodRawShape>;
	find: z.ZodTypeAny;
};

type FindService<E, V extends FindValidator> = {
	findByFilter(
		data: ValidatorOutput<V, 'find'>,
		withDeleted: boolean,
	): Promise<[E[], number]>;
};

type ControllerFindType<E, V extends FindValidator> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
	service: FindService<E, V>;
	findData: ValidatorInput<V, 'find'> & {
		filter: ValidatorInput<V, 'find'> extends { filter: infer F }
			? F
			: never;
	};
};

export function testControllerFind<E, V extends FindValidator>(
	config: ControllerFindType<E, V>,
) {
	describe(`${config.controller} - find`, () => {
		// it('failed validation', async () => {
		// 	authorizedSpy(config.policy);
		//
		// 	const response = await request(app).get(config.route).query({});
		//
		// 	withDebugResponse(() => {
		// 		expect(response.status).toBe(422);
		// 	}, response);
		// });

		it('should return success', async () => {
			const mockFindData = config.findData;

			authorizedSpy(config.policy);

			jest.spyOn(config.service, 'findByFilter').mockResolvedValue([
				[config.entityMock],
				1,
			]);

			const response = await request(app)
				.get(config.route)
				.query(mockFindData);

			withDebugResponse(() => {
				expect(response.status).toBe(200);
				expect(response.body.data.entries).toHaveLength(1);
			}, response);
		});
	});
}

// Controller test - Update
type StatusUpdateService<E> = {
	findById(id: EntityId, withDeleted?: boolean): Promise<E>;
	updateStatus(entry: E, status: string): Promise<void>;
};

type ControllerStatusUpdateType<E> = {
	controller: string;
	route: string;
	entityMock: E & {
		id: EntityId;
	};
	policy: PolicyAbstract;
	service: StatusUpdateService<E>;
};

export function testControllerStatusUpdate<E>(
	config: ControllerStatusUpdateType<E>,
) {
	describe(`${config.controller} - statusUpdate`, () => {
		it('should fail if not authenticated', async () => {
			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(401);
			}, response);
		});

		it("should fail if it doesn't have proper permission", async () => {
			notAuthorizedSpy(config.policy);

			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(403);
			}, response);
		});

		it('should return success', async () => {
			authorizedSpy(config.policy);

			jest.spyOn(config.service, 'findById').mockResolvedValue(
				config.entityMock,
			);

			jest.spyOn(config.service, 'updateStatus').mockResolvedValue(
				undefined,
			);

			const response = await request(app).patch(config.route).query({});

			withDebugResponse(() => {
				expect(response.status).toBe(200);
				expect(response.body).toHaveProperty('success', true);
			}, response);
		});
	});
}
