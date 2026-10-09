import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A cron run is recorded when it starts, as `running`, and completed when it ends - so a run that
 * hangs, or whose process dies, leaves a row behind. `end_at` is NULL until then.
 *
 * The enum is rebuilt rather than extended with `ADD VALUE`, which cannot be undone in place: the
 * `down` has to rebuild it anyway, and both directions then read the same way.
 */
export class CronHistoryRunning1794400000000 implements MigrationInterface {
	name = 'CronHistoryRunning1794400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await this.rebuildStatusEnum(queryRunner, [
			'error',
			'ok',
			'warning',
			'running',
		]);

		await queryRunner.query(
			`ALTER TABLE "logs"."cron_history" ALTER COLUMN "end_at" DROP NOT NULL`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// A run that never finished is the closest thing the old shape has to a failure
		await queryRunner.query(
			`UPDATE "logs"."cron_history" SET "status" = 'error', "end_at" = "start_at" WHERE "status" = 'running'`,
		);

		await queryRunner.query(
			`UPDATE "logs"."cron_history" SET "end_at" = "start_at" WHERE "end_at" IS NULL`,
		);

		await queryRunner.query(
			`ALTER TABLE "logs"."cron_history" ALTER COLUMN "end_at" SET NOT NULL`,
		);

		await this.rebuildStatusEnum(queryRunner, ['error', 'ok', 'warning']);
	}

	private async rebuildStatusEnum(
		queryRunner: QueryRunner,
		values: string[],
	): Promise<void> {
		const list = values.map((value) => `'${value}'`).join(', ');

		await queryRunner.query(
			`CREATE TYPE "logs"."cron_history_status_enum_new" AS ENUM(${list})`,
		);
		await queryRunner.query(
			`ALTER TABLE "logs"."cron_history" ALTER COLUMN "status" TYPE "logs"."cron_history_status_enum_new" USING "status"::text::"logs"."cron_history_status_enum_new"`,
		);
		await queryRunner.query(`DROP TYPE "logs"."cron_history_status_enum"`);
		await queryRunner.query(
			`ALTER TYPE "logs"."cron_history_status_enum_new" RENAME TO "cron_history_status_enum"`,
		);
	}
}
