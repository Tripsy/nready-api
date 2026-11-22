import type { NextFunction, Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { CustomError } from '@/exceptions';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * Decides what the client is allowed to read.
 *
 * Anything that is not a `CustomError` reached us unplanned - a TypeORM driver error, a
 * failed JSON parse, a `TypeError` - and its `message` routinely contains SQL fragments,
 * file paths or column names. The same holds for deliberate 5xx (`CustomError(500, ...)`),
 * whose messages describe internal repository state. So every 5xx collapses to one generic
 * string unless `app.debug` is on; 4xx messages are written for the client and pass through.
 *
 * The real error is still logged in full below - masking is a response-shaping concern only.
 *
 * Not applied under `test`: the suite runs with `APP_DEBUG=false`, so masking would leave
 * every failing controller test reporting only `shared.error.server_error` and hide the
 * actual cause from `withDebugResponse`.
 */
function clientMessage(err: Error, status: number): string {
	if (
		status < 500 ||
		Configuration.get('app.debug') ||
		Configuration.isEnvironment('test')
	) {
		return err.message;
	}

	return lang('shared.error.server_error');
}

export const errorHandler = (
	err: Error,
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const status = err instanceof CustomError ? err.statusCode : 500;

	// Logging is disabled for certain response codes when APP debug is false
	if (
		!Configuration.isEnvironment('test') &&
		(Configuration.get('app.debug') ||
			![400, 401, 403, 404, 409].includes(status))
	) {
		if ([401].includes(status)) {
			getSystemLogger().warn(
				{
					err: err,
					request: {
						method: req.method,
						url: req.originalUrl,
						body: req.body,
						params: req.params,
						query: req.query,
					},
				},
				`${err.name}: ${err.message}`,
			);
		} else {
			getSystemLogger().error(
				{
					err: err,
					request: {
						method: req.method,
						url: req.originalUrl,
						body: req.body,
						params: req.params,
						query: req.query,
					},
				},
				`${err.name}: ${err.message}`,
			);
		}
	}

	/*
	 * A response is already on the wire - a handler that failed after
	 * `requestTimeoutMiddleware` answered, or one that failed mid-stream. A second envelope
	 * would throw ERR_HTTP_HEADERS_SENT; Express's default handler closes the connection
	 * instead. The error is still logged above.
	 */
	if (res.headersSent) {
		next(err);

		return;
	}

	res.status(status);

	const message = clientMessage(err, status);

	if (res.locals?.output) {
		res.locals.output.success(false).message(message);
		res.json(res.locals.output);
	} else {
		// No `outputHandler` yet - the error was thrown before it ran. Hand back the
		// standard envelope by hand rather than serializing the raw error object.
		res.json({ success: false, message });
	}
};
