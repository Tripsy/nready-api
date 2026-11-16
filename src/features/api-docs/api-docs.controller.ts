import type { Request, Response } from 'express';
import { Configuration } from '@/config/settings.config';
import { NotFoundError } from '@/exceptions';
import {
	type ApiDocsPolicy,
	apiDocsPolicy,
} from '@/features/api-docs/api-docs.policy';
import { ApiDocsValidator } from '@/features/api-docs/api-docs.validator';
import {
	type FeatureDocumentationEntry,
	getFeatureDocumentation,
	listFeatureDocumentation,
} from '@/helpers/api-documentation.helper';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Where the documented API answers, spelled as a caller would type it.
 *
 * `APP_URL` carries the host alone in this project - `server.ts` prints its own address as
 * `${app.url}:${app.port}` and the frontend's `REMOTE_API_URL` names the port too - so the
 * port is joined back on here or every printed example would be aimed at port 80 and 404.
 * A URL that already names its own port is left as it is.
 */
function documentationBaseUrl(): string {
	const url = Configuration.get('app.url');

	// Anchored at the end, so it matches a port on the authority and not the `http:` scheme.
	return /:\d+$/.test(url) ? url : `${url}:${Configuration.get('app.port')}`;
}

/**
 * How much of a module a caller needs a token for.
 *
 * Read off each action's `authorization` rather than off the `/public/...` base path: that
 * prefix is a naming convention, while `authorization` is what the route enforces - and the
 * two disagree, since `complaint-public` is mounted under `/public` and asks for a bearer
 * token on every action. `partial` has no module today but is reachable the moment one gains
 * an open action beside a gated one, and a two-state flag would badge that wrong.
 */
function authorizationScope(
	entry: FeatureDocumentationEntry,
): 'none' | 'partial' | 'required' {
	const actions = Object.values(entry.actions);
	const gated = actions.filter((action) => !!action.authorization).length;

	if (gated === 0) {
		return 'none';
	}

	return gated === actions.length ? 'required' : 'partial';
}

/**
 * Serves the documentation generated at boot from every `<module>.docs.ts`.
 *
 * Admin only (`ApiDocsPolicy.canView`) - the frontend's `/api-docs` pages and its dashboard
 * usage guide render it, both for an admin alone. Nothing it returns is data - only the shape
 * of a request and the sample payloads the docs files declare - and every documented endpoint
 * still enforces its own permission when called; the gate keeps the map of the whole API to
 * administrators.
 *
 * Mounted under `/public` although every action asks for a token, like `complaint-public`: the
 * path is what the frontend calls, and `authorization` on each action is what is enforced.
 */
class ApiDocsController extends BaseController {
	constructor(
		private policy: ApiDocsPolicy,
		private validator: ApiDocsValidator,
	) {
		super();
	}

	/**
	 * The reference is opt-in per environment. Off answers 404 rather than 403, so an
	 * environment that does not publish its API says nothing about whether there is
	 * anything to publish - and it reads exactly like an undocumented feature does.
	 *
	 * Gated here rather than at route registration: the registry is still filled at boot,
	 * because the development-only `meta.documentation` echo on a failing request reads
	 * from the same generated output.
	 *
	 * Runs before the policy, so a disabled reference answers 404 to everyone - a 401 to a
	 * visitor would confirm the endpoint exists.
	 */
	private assertEnabled(): void {
		if (!Configuration.get('apiDocs.enabled')) {
			throw new NotFoundError();
		}
	}

	/**
	 * The catalog: one entry per documented route module, carrying enough of each action to
	 * list its endpoints without a request per feature.
	 */
	public find = asyncHandler(async (_req: Request, res: Response) => {
		this.assertEnabled();
		this.policy.canView(res.locals.auth);

		const entries = listFeatureDocumentation().map((entry) => ({
			feature: entry.feature,
			entity: entry.entity,
			basePath: entry.basePath,
			authorization: authorizationScope(entry),
			actions: Object.entries(entry.actions).map(([name, action]) => ({
				name: name,
				method: action.method,
				path: action.path,
				description: action.description,
				requires_authorization: !!action.authorization,
			})),
		}));

		res.locals.output.data({
			baseUrl: documentationBaseUrl(),
			entries: entries,
		});

		res.json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.assertEnabled();
		this.policy.canView(res.locals.auth);

		const { feature } = this.validate(this.validator.read, req.params, res);

		const documentation = getFeatureDocumentation(feature);

		if (!documentation) {
			throw new NotFoundError();
		}

		/*
		 * `baseUrl` rides along because the documented `path` is relative and a consumer
		 * rendering a runnable example has no other way to learn where this API answers -
		 * the frontend reaches it through its own proxy and never sees `REMOTE_API_URL`.
		 */
		res.locals.output.data({
			baseUrl: documentationBaseUrl(),
			feature: feature,
			entity: documentation.entity,
			basePath: documentation.basePath,
			authorization: authorizationScope({ feature, ...documentation }),
			actions: documentation.actions,
		});

		res.json(res.locals.output);
	});
}

export const apiDocsController = new ApiDocsController(
	apiDocsPolicy,
	new ApiDocsValidator('api-docs'),
);
