import type { NextFunction, Request, Response } from 'express';
import { validate as isUuid } from 'uuid';
import { lang } from '@/config/message.setup';
import { BadRequestError } from '@/exceptions';
import { getRouteParam } from '@/helpers/request.helper';

export const validateParamsWhenId = (...args: string[]) => {
	return (req: Request, res: Response, next: NextFunction) => {
		const errors: Record<string, unknown>[] = [];

		for (const name of args) {
			/*
			 * Controllers may read the param straight off the route, so this is the only check it
			 * gets before reaching a query - and a malformed value would otherwise surface as a
			 * Postgres `invalid input syntax for type uuid` 500 rather than a 400.
			 */
			const param = getRouteParam(req, name);

			if (param === undefined || !isUuid(param.trim().toLowerCase())) {
				errors.push({
					[name]: lang('shared.validation.invalid_id', { name }),
				});
			}
		}

		if (errors.length > 0) {
			res.locals.output.errors(errors);

			throw new BadRequestError();
		}

		next(); // Proceed to the next middleware or route handler
	};
};

export const validateParamsWhenEnum = (data: Record<string, unknown[]>) => {
	return (req: Request, res: Response, next: NextFunction) => {
		const errors: Record<string, unknown>[] = [];

		for (const [name, allowedValues] of Object.entries(data)) {
			const value = getRouteParam(req, name);

			if (!allowedValues.includes(value)) {
				errors.push({
					[name]: lang('shared.validation.invalid_enum', {
						name: name,
						allowedValues: allowedValues.join(', '),
					}),
				});
			}
		}

		if (errors.length > 0) {
			res.locals.output.errors(errors);

			throw new BadRequestError();
		}

		next(); // Proceed to the next middleware or route handler
	};
};
