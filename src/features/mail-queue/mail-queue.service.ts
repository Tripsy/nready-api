import { validate as isUuid } from 'uuid';
import type MailQueueEntity from '@/features/mail-queue/mail-queue.entity';
import { getMailQueueRepository } from '@/features/mail-queue/mail-queue.repository';
import type { MailQueueValidator } from '@/features/mail-queue/mail-queue.validator';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class MailQueueService {
	constructor(
		private repository: ReturnType<typeof getMailQueueRepository>,
	) {}

	public async delete(data: ValidatorOutput<MailQueueValidator, 'delete'>) {
		return await this.repository
			.createQuery()
			.filterBy('id', data.ids, 'IN')
			.delete(false, true, true);
	}

	public findById(id: EntityId): Promise<MailQueueEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<MailQueueValidator, 'find'>) {
		const querySelect = [
			'id',
			'template.id',
			'template.label',
			'language',
			'content',
			'to',
			'from',
			'status',
			'error',
			'sent_at',
			'created_at',
			'updated_at',
		];

		const query = this.repository
			.createQuery()
			.select(querySelect)
			.join('mail_queue.template', 'template', 'LEFT')
			.filterById(data.filter.id)
			.filterByRange(
				'sent_at',
				data.filter.sent_date_start,
				data.filter.sent_date_end,
			)
			.filterBy('status', data.filter.status);

		// The filter accepts either side of the joined template: an id picks one exactly, any
		// other string searches the label
		if (data.filter.template && isUuid(data.filter.template)) {
			query.filterBy('template.id', data.filter.template);
		} else {
			query.filterBy('template.label', data.filter.template, 'LIKE');
		}

		return query
			.filterBy('content::text', data.filter.content, 'ILIKE')
			.filterBy('to::text', data.filter.to, 'ILIKE')
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const mailQueueService = new MailQueueService(getMailQueueRepository());
