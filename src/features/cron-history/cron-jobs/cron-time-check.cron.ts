import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import {
	createCurrentDate,
	createPastDate,
	formatDate,
} from '@/helpers/date.helper';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';
import type { EntityId } from '@/shared/types/entity-id.type';

export const SCHEDULE_EXPRESSION = '03 02 * * *';
export const EXPECTED_RUN_TIME = 3; // seconds

// Check if there are cron jobs starting at the same time in the last 24 hours
const cronTimeCheck = async () => {
	const querySql = `
		SELECT
			ch.id, 
			ch.label, 
			ch.start_at
		FROM logs.cron_history ch
		INNER JOIN (
			SELECT
				DATE(start_at) AS day,
				TO_CHAR(start_at, 'HH24:MI') AS hour_min,
				COUNT(id) AS count
			FROM logs.cron_history
			WHERE
				start_at >= $1::TIMESTAMP 
				AND start_at < $2::TIMESTAMP
			GROUP BY
				DATE(start_at),
				TO_CHAR(start_at, 'HH24:MI')
			HAVING COUNT(id) > 1
		) dup ON DATE(ch.start_at) = dup.day::DATE
			AND TO_CHAR(ch.start_at, 'HH24:MI') = dup.hour_min
		WHERE
			ch.start_at >= $1::TIMESTAMP 
			AND ch.start_at < $2::TIMESTAMP
		ORDER BY
			ch.start_at;
    `;

	const endDate = createCurrentDate().toISOString();
	const startDate = createPastDate(86400).toISOString();

	const queryParameters = [startDate, endDate];

	const results: {
		[key: string]: {
			date: string;
			entries: Array<{
				id: EntityId;
				label: string;
			}>;
		};
	} = {};

	const entries = await dataSource.query(querySql, queryParameters);

	if (entries.length > 0) {
		entries.forEach(
			(entry: { id: EntityId; label: string; start_at: Date }) => {
				const start_at = formatDate(entry.start_at) as string;

				if (!results[start_at]) {
					results[start_at] = {
						date: formatDate(entry.start_at) as string,
						entries: [],
					};
				}

				results[start_at].entries.push({
					id: entry.id,
					label: entry.label,
				});
			},
		);

		const emailTemplate = await loadEmailTemplate(
			'cron-time-check',
			Configuration.language(),
		);

		emailTemplate.content.vars = {
			results: results,
			querySql: querySql,
			queryParameters: JSON.stringify(queryParameters),
		};

		await queueEmail(emailTemplate, {
			name: Configuration.get('app.name'),
			address: Configuration.get('app.email'),
		});
	}

	return {
		results: results,
		overlapping: Object.keys(results).length,
	};
};

export default cronTimeCheck;
