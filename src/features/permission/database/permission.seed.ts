import { v4 as uuid } from 'uuid';
import dataSource from '@/config/data-source.config';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import PermissionEntity from '@/features/permission/permission.entity';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * The `delete` action is also considered for `restore` action
 */
const permissionArray = {
	user: ['create', 'read', 'update', 'delete', 'find'],
	permission: ['create', 'read', 'update', 'delete', 'find'],
	template: ['create', 'read', 'update', 'delete', 'find'],
	'log-data': ['read', 'delete', 'find'],
	'cron-history': ['read', 'delete', 'find'],
};

async function seedPermissions() {
	const connection = dataSource;

	try {
		console.debug('Initializing database connection...');
		await connection.initialize();

		const permissionData: { entity: string; operation: string }[] = [];

		for (const [entity, operations] of Object.entries(permissionArray)) {
			for (const operation of operations) {
				permissionData.push({ entity, operation });
			}
		}

		await requestContext.run(
			{
				auth_id: null,
				performed_by: 'permission.seed',
				source: RequestContextSourceEnum.SEED,
				request_id: uuid(),
				language: 'en',
			},
			async () => {
				await connection.transaction(
					async (transactionalEntityManager) => {
						console.debug('Clearing permission table...');

						const tableName =
							connection.getMetadata(PermissionEntity).tableName;
						const schemaName =
							connection.getMetadata(PermissionEntity).schema ||
							'system';

						// Raw SQL DELETE - won't trigger TypeORM subscribers
						await transactionalEntityManager.query(
							`DELETE FROM "${schemaName}"."${tableName}"`,
						);

						console.debug('Inserting new permissions...');

						// Insert new data
						const repository =
							transactionalEntityManager.getRepository(
								PermissionEntity,
							);
						await repository.save(permissionData);
					},
				);
			},
		);

		getSystemLogger().info('Permissions seeded successfully ✅');
	} catch (error) {
		console.error('Error seeding permissions:', error);
		throw error;
	} finally {
		// Only destroy if the connection was initialized
		if (connection?.isInitialized) {
			// Wait a moment to ensure all operations are complete
			await new Promise((resolve) => setTimeout(resolve, 500));
			await connection.destroy();
			console.debug('Database connection closed.');
		}
	}
}

(async () => {
	try {
		await seedPermissions();
		process.exit(0); // Exit successfully
	} catch (error) {
		console.error('Seeding failed:', error);
		process.exit(1); // Exit with error code
	}
})();
