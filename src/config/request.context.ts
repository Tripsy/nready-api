import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityId } from '@/shared/types/entity-id.type';

export const RequestContextSourceEnum = {
	CRON: 'cron',
	API: 'api',
	SEED: 'seed',
	UNKNOWN: 'unknown',
} as const;

export type RequestContextSource =
	(typeof RequestContextSourceEnum)[keyof typeof RequestContextSourceEnum];

export type RequestContext = {
	// Null when no user acts: a visitor, a cron run, a seed
	auth_id: EntityId | null;
	performed_by: string;
	request_id: string;
	source: RequestContextSource;
	language: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();
