import type { apiDocsController } from '@/features/api-docs/api-docs.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/**
 * The reference documents itself, so the catalog it serves lists the two endpoints that
 * produced it. Samples are trimmed to a single entry and a single action - the real payload
 * carries every documented module, which would bury the shape it is meant to show.
 */
export const docs: Record<
	keyof typeof apiDocsController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: 'List every documented route module',
		withBearerAuth: true,
		withAuthErrors: true,
		success: {
			status: 200,
			description: 'Documentation catalog',
			dataSample: {
				baseUrl: 'https://api.example.com',
				entries: [
					{
						feature: 'article-public',
						entity: 'article',
						basePath: '/public/articles',
						authorization: 'none',
						actions: [
							{
								name: 'read',
								method: 'get',
								path: '/public/articles/:slug',
								description:
									'Read one published article by slug',
								requires_authorization: false,
							},
						],
					},
				],
			},
		},
		request: {
			notes: 'Admin only. `authorization` summarizes the module - `none`, `partial` or `required` - from the per-action flag, so a module mounted under `/public` that still asks for a token is not mistaken for an open one. Takes no input and never changes between requests: the registry is filled once, at boot, from the `<module>.docs.ts` sitting beside each route file',
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Read the documentation of one route module',
		withBearerAuth: true,
		withAuthErrors: true,
		success: {
			status: 200,
			description: 'Route module documentation',
			dataSample: {
				baseUrl: 'https://api.example.com',
				feature: 'article-public',
				entity: 'article',
				basePath: '/public/articles',
				authorization: 'none',
				actions: {
					read: {
						description: 'Read one published article by slug',
						method: 'get',
						path: '/public/articles/:slug',
						request: {
							params: {
								slug: { type: 'string', required: true },
							},
						},
						responses: {
							'200': { description: 'Article details' },
						},
					},
				},
			},
		},
		withErrors: [404, 422],
		request: {
			notes: 'Admin only. A module with no `<module>.docs.ts` answers 404. The name is the route file, not the feature folder: a feature holding more than one module documents each under its own name - `article` and `article-public` both exist',
			params: {
				feature: {
					type: 'string',
					required: true,
					format: 'kebab-case',
					condition: 'one of the names `GET /public/api-docs` lists',
				},
			},
		},
	}),
};
