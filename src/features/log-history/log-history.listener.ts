import {
	eventEmitter,
	type LogHistoryEventPayload,
} from '@/config/event.config';
import { lang } from '@/config/message.setup';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import { getLogHistoryRepository } from '@/features/log-history/log-history.repository';
import { runInBackground } from '@/helpers/background.helper';
import { getHistoryLogger } from '@/providers/logger.provider';
import {
	LogHistoryActionEnum,
	type LogHistoryDestination,
} from '@/shared/types/log-history.type';

export default function registerLogHistoryListener() {
	eventEmitter.on('history', async (payload: LogHistoryEventPayload) => {
		const logDestination = Configuration.get(
			'logging.history',
		) as LogHistoryDestination;

		const ctx = requestContext.getStore();

		switch (logDestination) {
			case 'pino': {
				const replacements: Record<string, string> = {
					entity: payload.entity,
					action: payload.action,
					auth_id: ctx?.auth_id ?? 'none',
					performed_by: ctx?.performed_by || 'unknown',
					request_id: ctx?.request_id || 'unknown',
					source: ctx?.source || RequestContextSourceEnum.UNKNOWN,
					...payload.data,
				};

				if (
					payload.action === LogHistoryActionEnum.DELETED ||
					payload.action === LogHistoryActionEnum.REMOVED ||
					payload.action === LogHistoryActionEnum.RESTORED
				) {
					replacements.entity_ids = payload.entity_ids.join(', ');
				} else {
					replacements.entity_id = payload.entity_ids[0].toString();
				}

				getHistoryLogger().info(
					lang(
						`${payload.entity}.history.${payload.action}`,
						replacements,
					),
				);
				break;
			}

			case 'db': {
				runInBackground(
					getLogHistoryRepository().createLogs(
						payload.entity,
						payload.entity_ids,
						payload.action,
						ctx?.auth_id || null,
						ctx?.performed_by || 'unknown',
						ctx?.request_id || 'unknown',
						ctx?.source || RequestContextSourceEnum.UNKNOWN,
						payload.data,
					),
					`Failed to write history for ${payload.entity} ${payload.entity_ids.join(', ')}`,
				);

				break;
			}
		}
	});
}
