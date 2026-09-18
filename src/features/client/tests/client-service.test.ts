import { expect, jest } from '@jest/globals';
import type ClientEntity from '@/features/client/client.entity';
import {
	type ClientStatus,
	ClientStatusEnum,
} from '@/features/client/client.entity';
import {
	clientOutputPayloads,
	getClientEntityMock,
} from '@/features/client/client.mock';
import type { ClientQuery } from '@/features/client/client.repository';
import { ClientService } from '@/features/client/client.service';
import type { ClientValidator } from '@/features/client/client.validator';
import { getUserEntityMock } from '@/features/user/user.mock';
import type { UserService } from '@/features/user/user.service';
import {
	createMockRepository,
	testServiceDelete,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceRestore,
	testServiceUpdate,
	testServiceUpdateStatus,
} from '@/tests/jest-service.setup';

describe('ClientService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockClient = createMockRepository<ClientEntity, ClientQuery>();

	/*
	 * Only `findById` is reached - it is what turns a user_id into a 404 before the link is
	 * written, so the link can never point at a row that is not there.
	 */
	const userServiceMock = {
		findById: jest.fn<UserService['findById']>(),
	};

	const serviceClient = new ClientService(
		mockClient.repository,
		userServiceMock as unknown as UserService,
	);

	it('should create entry', async () => {
		const entity = getClientEntityMock();
		const createData = clientOutputPayloads.create;

		jest.spyOn(serviceClient, 'checkDuplicate').mockResolvedValue(
			undefined,
		);

		mockClient.repository.save.mockResolvedValue(entity);

		const result = await serviceClient.create(createData);

		// No owner passed - the back office records a client nobody has claimed
		expect(mockClient.repository.save).toHaveBeenCalledWith(
			expect.objectContaining({ user_id: null }),
		);
		expect(result).toBe(entity);
	});

	it('should create entry linked to an account', async () => {
		const entity = getClientEntityMock();
		const createData = clientOutputPayloads.create;

		jest.spyOn(serviceClient, 'checkDuplicate').mockResolvedValue(
			undefined,
		);

		mockClient.repository.save.mockResolvedValue(entity);

		await serviceClient.create(createData, 7);

		/*
		 * The owner reaches the row from the argument, never from the payload - without it the
		 * client is stored unlinked and `findOwn` cannot see it again.
		 */
		expect(mockClient.repository.save).toHaveBeenCalledWith(
			expect.objectContaining({ user_id: 7 }),
		);
	});

	testServiceUpdate<ClientEntity>(
		serviceClient,
		mockClient.repository,
		getClientEntityMock(),
	);

	testServiceUpdateStatus<ClientEntity, ClientStatus>(
		serviceClient,
		mockClient.repository,
		{
			good: {
				from: ClientStatusEnum.INACTIVE,
				to: ClientStatusEnum.ACTIVE,
			},
			bad: undefined,
		},
	);

	testServiceFindById<ClientEntity, ClientQuery>(
		mockClient.query,
		serviceClient,
	);

	testServiceFindByFilter<ClientEntity, ClientQuery, ClientValidator>(
		mockClient.query,
		serviceClient,
		clientOutputPayloads.find,
	);

	testServiceDelete<ClientEntity, ClientQuery>(
		mockClient.query,
		serviceClient,
	);
	testServiceRestore<ClientEntity, ClientQuery>(
		mockClient.query,
		serviceClient,
	);

	it('updateAccount - should link the client to an account', async () => {
		const entity = getClientEntityMock();
		entity.user_id = null;

		userServiceMock.findById.mockResolvedValue(getUserEntityMock());
		mockClient.repository.save.mockResolvedValue(entity);

		await serviceClient.updateAccount(entity, 7);

		expect(userServiceMock.findById).toHaveBeenCalledWith(7, false);
		expect(entity.user_id).toBe(7);
		expect(mockClient.repository.save).toHaveBeenCalled();
	});

	it('updateAccount - should unlink without looking up an account', async () => {
		const entity = getClientEntityMock();

		mockClient.repository.save.mockResolvedValue(entity);

		await serviceClient.updateAccount(entity, null);

		// Null is the unlink, not a missing value, so there is no account to check
		expect(userServiceMock.findById).not.toHaveBeenCalled();
		expect(entity.user_id).toBeNull();
		expect(mockClient.repository.save).toHaveBeenCalled();
	});

	it("findOwn - should return one account's clients, newest first", async () => {
		const entries = [getClientEntityMock()];

		/*
		 * `all` is overloaded and the mock's type resolves to the counted form, so the plain
		 * array this finder asks for goes in through a cast.
		 */
		mockClient.query.all.mockResolvedValue(
			entries as unknown as [ClientEntity[], number],
		);

		const result = await serviceClient.findOwn(7);

		expect(mockClient.query.filterBy).toHaveBeenCalledWith('user_id', 7);
		expect(mockClient.query.orderBy).toHaveBeenCalledWith('id', 'DESC');
		expect(result).toBe(entries);
	});

	it('findOwnById - should scope the lookup to the account', async () => {
		const entity = getClientEntityMock();

		mockClient.query.firstOrFail.mockResolvedValue(entity);

		const result = await serviceClient.findOwnById(entity.id, 7);

		// Both filters, so somebody else's client answers the same 404 a missing one does
		expect(mockClient.query.filterById).toHaveBeenCalledWith(entity.id);
		expect(mockClient.query.filterBy).toHaveBeenCalledWith('user_id', 7);
		expect(result).toBe(entity);
	});
});
