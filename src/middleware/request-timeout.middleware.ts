import type { NextFunction, Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { CustomError } from '@/exceptions';
import { errorHandler } from '@/middleware/error-handler.middleware';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * Answers 503 once a request's socket has been idle for `app.request_timeout` milliseconds.
 *
 * Idle, not total duration: the timer restarts on every byte written, so a long-lived
 * response that keeps writing (an event stream with a heartbeat shorter than the timeout)
 * is never cut, while a handler that stalls without answering is.
 *
 * Set on the response, not the request. Node raises a socket timeout on the request only
 * while its body is still arriving; once it is complete - any GET - `req.setTimeout`'s
 * callback never runs, and Node silently destroys the socket instead. The response receives
 * the event for as long as it is the socket's current message.
 *
 * The response is formatted by calling `errorHandler` directly. `next(error)` is not an
 * option here: `next()` has already run, and calling it again from a timer resumes the router
 * from wherever the request has got to.
 *
 * Node cannot cancel the handler. It keeps running, and its own `res.json` later fails with
 * ERR_HTTP_HEADERS_SENT, which `errorHandler` passes to Express's default handler. Work it
 * commits after the 503 still lands - a timeout tells the client the outcome is unknown, not
 * that nothing happened. The 503 message is masked outside debug, like every 5xx.
 */
export function requestTimeoutMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	res.setTimeout(Configuration.get('app.request_timeout'), () => {
		if (res.headersSent) {
			// Mid-response: a status can no longer be sent, so end the connection rather
			// than leave the client waiting on a body that may never complete
			getSystemLogger().warn(
				`Request timeout after headers were sent: ${req.method} ${req.originalUrl} (${res.locals.request_id})`,
			);

			res.destroy();

			return;
		}

		errorHandler(
			new CustomError(503, lang('shared.error.request_timeout')),
			req,
			res,
			next,
		);
	});

	next();
}
