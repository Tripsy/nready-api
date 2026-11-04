export type HttpStatusCode =
	| 200 // OK
	| 201 // Created
	| 204 // No Content
	| 400 // Bad Request
	| 401 // Unauthorized
	| 403 // Forbidden
	| 404 // Not Found
	| 406 // Not Acceptable
	| 409 // Conflict
	| 422 // Unprocessable Content
	| 425 // Indicates that the server is unwilling to risk processing a request that might be replayed.
	| 429 // Too Many Requests
	| 500 // Internal Server Error
	| 501 // Not Implemented - the request is well-formed, this deployment does not offer the capability (e.g. an unconfigured OAuth provider)
	| 502 // Bad Gateway - an upstream the server depends on failed (e.g. an identity provider)
	| 503; // Service Unavailable - the request outran `app.request_timeout`

export class CustomError extends Error {
	public statusCode: HttpStatusCode;

	constructor(statusCode: HttpStatusCode, message?: string) {
		super();

		this.message = message ?? 'Error';
		this.statusCode = statusCode;
	}
}
