import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { invoicePublicController } = await import(
		'@/features/invoice/invoice-public.controller'
	);

	const config: FeatureRoutesModule<typeof invoicePublicController> = {
		basePath: '/public',
		controller: invoicePublicController,
		routes: {
			/*
			 * Nested under the buyer's order, as `shipping-public.routes.ts` is and for its reason:
			 * the order is what the caller is proven to own, and everything read here hangs off it.
			 */
			billing: {
				path: '/orders/:order_id/billing',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
			},
			document: {
				path: '/orders/:order_id/invoices/:id',
				method: 'get',
				handlers: [
					validateParamsWhenId('order_id'),
					validateParamsWhenId('id'),
				],
			},
		},
	};

	return config;
};
