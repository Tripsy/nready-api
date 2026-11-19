import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import { v7 as uuid } from 'uuid';
import { requestContext } from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import { buildLogDestinations } from '@/providers/logger/log-destinations.factory';
import type {
	CallStack,
	LogDestination,
	LogRecord,
} from '@/shared/types/log.type';
import {
	LogDataCategoryEnum,
	type LogDataLevel,
	LogDataLevelEnum,
} from '@/shared/types/log-data.type';

export function getLogLevel(level: number): LogDataLevel {
	switch (level) {
		case 10:
			return LogDataLevelEnum.TRACE;
		case 20:
			return LogDataLevelEnum.DEBUG;
		case 30:
			return LogDataLevelEnum.INFO;
		case 40:
			return LogDataLevelEnum.WARN;
		case 50:
			return LogDataLevelEnum.ERROR;
		case 60:
			return LogDataLevelEnum.FATAL;
		default:
			throw new Error(`Unknown log level: ${level}`);
	}
}

function formatCallStack(
	stack: string,
	filtersForCallStack: string[] = [],
): CallStack {
	const result: CallStack = {
		file: 'Unknown file',
		line: 0,
		function: 'Unknown function',
		trace: [],
	};

	const combinedFilters = [
		...filtersForCallStack,
		'/node_modules',
		'internal/modules',
	];

	let [, ...stackArray]: string[] = stack
		.split('\n')
		.map((line) => line.trim()); // The first line from the call stack is removed

	stackArray = stackArray.filter((item) => {
		// Check if the item contains any of the words in combinedFilters
		return !combinedFilters.some((word) => item.includes(word));
	});

	if (stackArray.length > 0) {
		const match = stackArray[0].match(
			/at (?:([^ ]+) )?\(?(.+):(\d+):(\d+)\)?/,
		);

		if (match) {
			const [, functionName = '<anonymous>', filePath, line] = match;

			result.file = filePath;
			result.line = parseInt(line, 10) || 0;
			result.function = functionName;
			result.trace = stackArray;
		} else {
			result.trace = stackArray;
		}
	}

	return result;
}

/**
 * Pino's raw line, before normalization. `context` is pino's `nestedKey`, so anything the
 * caller passed as an object lands there along with the mixin's additions.
 */
type PinoLog = {
	level: number;
	time: number;
	pid: string;
	msg: string;
	category?: string;
	context?: Record<string, unknown> & {
		request_id?: string;
		debugStack?: CallStack;
	};
};

/**
 * Fans one pino line out to every destination that accepts its level.
 *
 * Everything about *where* a log goes now lives in `providers/logger/` behind
 * `LogDestination`; this class only normalizes the line and dispatches it. Adding a sink
 * does not touch this file.
 */
export class LogStream extends Writable {
	constructor(private readonly destinations: LogDestination[]) {
		super();
	}

	/**
	 * Flattens pino's shape into the record destinations consume, lifting `request_id`
	 * and `debugStack` out of `context` so a destination doesn't have to know that pino
	 * nested them there.
	 */
	private toRecord(log: PinoLog, raw: string): LogRecord {
		const { request_id, debugStack, ...context } = log.context ?? {};

		return {
			level: getLogLevel(log.level),
			time: log.time,
			pid: log.pid,
			message: log.msg,
			category: (log.category ??
				LogDataCategoryEnum.SYSTEM) as LogRecord['category'],
			request_id,
			debugStack,
			context: Object.keys(context).length > 0 ? context : undefined,
			raw,
		};
	}

	/**
	 * Dispatch is deliberately fire-and-forget: pino writes synchronously and blocking a
	 * log call on a database insert or an AWS round trip would put request latency at the
	 * mercy of the log sinks. `callback()` therefore signals completion once the writes
	 * are *dispatched*, and `close()` is what guarantees delivery at shutdown.
	 */
	_write(chunk: string, _encoding: string, callback: () => void): void {
		try {
			const log: PinoLog = JSON.parse(chunk);
			const record = this.toRecord(log, chunk);

			for (const destination of this.destinations) {
				if (!destination.levels.includes(record.level)) {
					continue;
				}

				destination.write(record).catch((error: unknown) => {
					// Never route this through the logger - it would recurse.
					console.error(
						`Log destination "${destination.name}" failed:`,
						error,
					);
				});
			}
		} catch (error) {
			console.error('LogStream error:', error);
		}

		callback();
	}

	/** Flush every destination that holds buffered state. Called from `closeHandler`. */
	async close(): Promise<void> {
		await Promise.allSettled(
			this.destinations.map((destination) => destination.close?.()),
		);
	}
}

const logStream = new LogStream(buildLogDestinations());

/**
 * The process-wide stream, exported so shutdown can flush the *same* instance that has
 * been collecting logs. Constructing a fresh `LogStream` to close would flush nothing.
 */
export function getLogStream(): LogStream {
	return logStream;
}

const logger = pino(
	{
		// The minimum level to log: Pino will not log messages with a lower level.
		// Setting this option reduces the load, as typically, debug and trace logs are only valid for development and not needed in production.
		// 'fatal', 'error', 'warn', 'info', 'debug', 'trace' or 'silent'
		level: Configuration.isEnvironment('test')
			? 'error'
			: Configuration.get('logging.logLevel'),
		// Defines how and where to send log data, such as to files, external services, or streams.
		nestedKey: 'context',
		// Define default properties included in every log line.
		base: {
			pid: uuid(),
		},
		// Note: Attempting to format time in-process will significantly impact logging performance.
		mixin: (context, _level, _logger) => {
			const ctx = requestContext.getStore();

			if ('err' in context && context.err instanceof Error) {
				const { name, message, stack } = context.err;

				delete context.err; // Removes the 'err' key from the context object

				return {
					...context,
					/*
					 * What went wrong, kept apart from where: `formatCallStack` drops the stack's
					 * first line, which is the only place the name and message appear, and a
					 * handler that logs and swallows - every hook notification - leaves nothing
					 * else behind. Name and message only: a driver error's `query` / `parameters`
					 * would carry bound values into the log (`rules/database.md` §7).
					 */
					error: `${name}: ${message}`,
					request_id: ctx?.request_id,
					debugStack: formatCallStack(stack || ''),
				};
			}

			return {
				...context,
				request_id: ctx?.request_id,
				debugStack: formatCallStack(new Error().stack || '', [
					'logger.provider.ts',
				]),
			};
		},
		// Remove sensitive information from logs
		redact: {
			paths: ['req.headers.authorization'],
			remove: true,
		},
		serializers: {
			user: (user) => {
				return {
					id: user.id,
					name: user.name,
					email: user.email
						? user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
						: undefined,
				};
			},
		},
	},
	logStream,
);

let systemLoggerInstance: Logger | null = null;

export function getSystemLogger(): Logger {
	if (!systemLoggerInstance) {
		systemLoggerInstance = logger.child({
			category: LogDataCategoryEnum.SYSTEM,
		});
	}
	return systemLoggerInstance;
}

let historyLoggerInstance: Logger | null = null;

export function getHistoryLogger(): Logger {
	if (!historyLoggerInstance) {
		historyLoggerInstance = logger.child({
			category: LogDataCategoryEnum.HISTORY,
		});
	}
	return historyLoggerInstance;
}

let cronLoggerInstance: Logger | null = null;

export function getCronLogger(): Logger {
	if (!cronLoggerInstance) {
		cronLoggerInstance = logger.child({
			category: LogDataCategoryEnum.CRON,
		});
	}
	return cronLoggerInstance;
}

if (Configuration.isEnvironment('test')) {
	getSystemLogger().debug = () => {};
	getSystemLogger().error = console.error;
}
