import { type Job, Worker } from 'bullmq';
import { Configuration } from '@/config/settings.config';
import { MailQueueStatusEnum } from '@/features/mail-queue/mail-queue.entity';
import { getMailQueueRepository } from '@/features/mail-queue/mail-queue.repository';
import { createCurrentDate } from '@/helpers/date.helper';
import { type EmailQueueData, sendEmail } from '@/providers/email.provider';
import { getSystemLogger } from '@/providers/logger.provider';

/*
 * The worker runs inside the API process and owns no lifecycle of its own: it registers no
 * signal handlers and never calls `process.exit`. Shutdown belongs to `server.ts`, which closes
 * it through `closeEmailWorker()` before the database and Redis connections a job in progress
 * still writes through. Importing this module has no side effect - nothing connects until
 * `startEmailWorker()` runs.
 */
let emailWorker: Worker<EmailQueueData> | null = null;

async function processEmailJob(job: Job<EmailQueueData>): Promise<void> {
	const { mailQueueId, emailContent, to, from } = job.data;

	try {
		getSystemLogger().info(
			`Processing email job ${job.id} for mailQueueId: ${mailQueueId}`,
		);

		await sendEmail({
			content: emailContent,
			to: to,
			from: from,
		});

		await getMailQueueRepository().update(mailQueueId, {
			status: MailQueueStatusEnum.SENT,
			error: null,
			sent_at: createCurrentDate(),
		});

		getSystemLogger().info(`Successfully processed email job ${job.id}`);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';

		getSystemLogger().error(
			`Failed to process email job ${job.id}: ${errorMessage}`,
		);

		await getMailQueueRepository().update(mailQueueId, {
			status: MailQueueStatusEnum.ERROR,
			error: errorMessage,
			sent_at: createCurrentDate(),
		});
	}
}

export function startEmailWorker(): Worker<EmailQueueData> {
	if (emailWorker) {
		return emailWorker;
	}

	emailWorker = new Worker<EmailQueueData>('emailQueue', processEmailJob, {
		/*
		 * A dedicated connection, not the shared `getRedisClient()` singleton: a BullMQ
		 * worker issues blocking reads (BRPOPLPUSH), which occupy the connection for the
		 * length of the block and would stall every other command sharing it.
		 *
		 * The password is not optional. Without it this silently works anywhere Redis is
		 * unauthenticated - every development machine - and fails in production with
		 * "NOAUTH Authentication required", surfacing as emails that never arrive while the
		 * API keeps reporting success.
		 */
		connection: {
			host: Configuration.get('redis.host'),
			port: Configuration.get('redis.port'),
			password: Configuration.get('redis.password'),
		},
		concurrency: 5,
	});

	// Worker-level errors (Redis connection issues, etc.)
	emailWorker.on('error', (err: Error) => {
		getSystemLogger().error(
			{
				err: {
					message: err.message,
					stack: err.stack,
					name: err.name,
				},
			},
			'Email worker error',
		);
	});

	emailWorker.on('ready', () => {
		getSystemLogger().debug('Email worker is ready and listening for jobs');
	});

	return emailWorker;
}

/**
 * Stops taking jobs and waits for the ones in progress to finish, so a send is not cut off
 * halfway and retried by BullMQ as stalled - which would deliver the email twice. A no-op
 * when the worker was never started (`worker.enabled` off).
 */
export async function closeEmailWorker(): Promise<void> {
	if (!emailWorker) {
		return;
	}

	const worker = emailWorker;

	emailWorker = null;

	await worker.close();
}
