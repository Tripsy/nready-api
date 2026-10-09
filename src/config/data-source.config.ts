import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildSrcPath, SOURCE_EXTENSION } from '@/helpers/system.helper';

const filesExtension = SOURCE_EXTENSION;

const dataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '5432', 10),
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	database: process.env.DB_NAME || 'nready-app',
	synchronize: false,
	logging: false,
	migrationsTableName: 'system.migrations',
	entities: [buildSrcPath(`features/**/*.entity.${filesExtension}`)],
	migrations: [buildSrcPath(`database/migrations/*.${filesExtension}`)],
	subscribers: [buildSrcPath(`features/**/*.subscriber.${filesExtension}`)],
	poolSize: 10,
});

export default dataSource;
