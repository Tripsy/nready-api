/*
 * Also loaded first by `server.ts`. Kept here because tests enter through `createApp()` and
 * never import `server.ts`, and TypeORM's decorators need the metadata API before any entity
 * module evaluates.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import qs from 'qs';
import dataSource from '@/config/data-source.config';
import { getRedisClient } from '@/config/init-redis.config';
import { Configuration } from '@/config/settings.config';
import { createCurrentDate } from '@/helpers/date.helper';
import authMiddleware from '@/middleware/auth.middleware';
import {
	clientKeyMiddleware,
	reportClientKeyState,
} from '@/middleware/client-key.middleware';
import { corsHandler } from '@/middleware/cors-handler.middleware';
import { errorHandler } from '@/middleware/error-handler.middleware';
import languageMiddleware from '@/middleware/language.middleware';
import { notFoundHandler } from '@/middleware/not-found-handler.middleware';
import { outputHandler } from '@/middleware/output-handler.middleware';
import { requestContextMiddleware } from '@/middleware/request-context.middleware';
import { requestTimeoutMiddleware } from '@/middleware/request-timeout.middleware';

/** How long `/ready` waits on each dependency before calling it down. */
const READINESS_CHECK_TIMEOUT = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;

	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Timed out after ${ms}ms`)),
			ms,
		);
	});

	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/*
 * Database and Redis are the two dependencies no request can do without. Redis is judged by
 * its connection status rather than a PING: ioredis queues commands while reconnecting, so a
 * PING against a down Redis would wait out the retries instead of answering.
 */
async function checkReadiness(): Promise<Record<string, boolean>> {
	const database = dataSource.isInitialized
		? await withTimeout(
				dataSource.query('SELECT 1'),
				READINESS_CHECK_TIMEOUT,
			)
				.then(() => true)
				.catch(() => false)
		: false;

	const redis = getRedisClient().status === 'ready';

	return { database, redis };
}

export async function createApp() {
	const app = express();

	// Helmet security headers (configured for API)
	app.use(
		helmet({
			/**
			 * APIs don't render HTML.
			 */
			contentSecurityPolicy: {
				useDefaults: false,
				directives: {
					defaultSrc: ["'none'"],
				},
			},

			/**
			 * Send no `Referer` header when a browser follows a link out of a response,
			 * so API URLs (and any tokens in their query) never leak to a third party.
			 */
			referrerPolicy: { policy: 'no-referrer' },

			/**
			 * Forbid framing outright - nothing here is meant to render in an iframe.
			 */
			frameguard: { action: 'deny' },

			/**
			 * HSTS only in production.
			 * WARNING: Never enable in dev or localhost.
			 */
			hsts: Configuration.isEnvironment('production')
				? { maxAge: 31536000, includeSubDomains: true }
				: false,

			// `noSniff` and `hidePoweredBy` are helmet defaults and stay on
		}),
	);

	/*
	 * Configuration
	 *
	 * In production the app sits behind exactly one reverse proxy, so `req.ip` must come
	 * from X-Forwarded-For rather than the socket - otherwise every request looks like it
	 * originates from the proxy's address. That single shared address would collapse
	 * `express-rate-limit` into one global bucket for all callers, and make every logged IP
	 * identical.
	 *
	 * The value is the hop count, not a boolean, and it must match the real topology: the
	 * proxy is expected to *replace* X-Forwarded-For so the header carries exactly one
	 * entry. Trusting more hops than exist would let a caller forge the header and evade
	 * rate limiting by spoofing an address.
	 *
	 * Left off outside production, where the app is reached directly and any
	 * X-Forwarded-For is untrusted input.
	 */
	app.set(
		'trust proxy',
		Configuration.isEnvironment('production') ? 1 : false,
	);

	// CORS handling
	app.use(corsHandler);

	/*
	 * Client key gate. Sits directly behind CORS and ahead of the body parsers so an
	 * unkeyed caller is refused before a 10mb body is read; `/health` and `/ready` are
	 * exempt inside the middleware.
	 */
	reportClientKeyState();
	app.use(clientKeyMiddleware);

	/*
	 * Probes - ahead of parsing, auth and the feature routers, none of which they need, so a
	 * probe never pays for a token check. Both answer raw JSON, outside the envelope.
	 */
	app.get('/health', (_req, res) => {
		res.status(200).json({
			status: 'OK',
			timestamp: createCurrentDate().toISOString(),
			uptime: process.uptime(),
		});
	});

	app.get('/ready', async (_req, res) => {
		const checks = await checkReadiness();
		const ready = Object.values(checks).every(Boolean);

		res.status(ready ? 200 : 503).json({ ready, checks });
	});

	// Compression
	app.use(
		compression({
			threshold: 1024,
			filter: (req: Request, res: Response): boolean => {
				// Opt-out header; small responses are skipped by `threshold`
				const skip = req.get('x-no-compression');

				if (skip) {
					return false;
				}

				return compression.filter(req, res);
			},
		}),
	);

	// Request parsing
	app.use(cookieParser());
	app.use(express.json({ limit: '10mb' }));
	app.use(express.urlencoded({ extended: true, limit: '10mb' }));

	// Request ID and build version on every response
	app.use((_req, res, next) => {
		res.locals.request_id = randomUUID();
		res.setHeader('X-Request-ID', res.locals.request_id);
		res.setHeader('X-App-Version', Configuration.get('app.version'));

		next();
	});

	// Request timeout
	app.use(requestTimeoutMiddleware);

	// Middleware
	app.set('query parser', (str: string) =>
		qs.parse(str, { allowDots: true }),
	);
	app.use(outputHandler); // Set `res.locals.output`

	app.use(languageMiddleware); // Set `res.locals.language` (drives content/email language, not messages)

	if (!Configuration.isEnvironment('test')) {
		app.use(authMiddleware); // Set `res.locals.auth`
	}

	app.use(requestContextMiddleware); // Prepare `requestContext`

	// Routes
	const { initRoutes } = await import('@/config/routes.setup');
	const router = await initRoutes();
	app.use(router);

	// Error handlers (must be last)
	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}
