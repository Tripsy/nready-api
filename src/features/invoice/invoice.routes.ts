import { InvoiceStatusEnum } from '@/features/invoice/invoice.entity';
import {
	validateParamsWhenEnum,
	validateParamsWhenId,
} from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { invoiceController } = await import(
		'@/features/invoice/invoice.controller'
	);

	const config: FeatureRoutesModule<typeof invoiceController> = {
		basePath: '/invoices',
		controller: invoiceController,
		routes: {
			create: {
				path: '',
				method: 'post',
			},
			createCustom: {
				path: '/custom',
				method: 'post',
			},
			read: {
				path: '/:id',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			document: {
				path: '/:id/document',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			update: {
				path: '/:id',
				method: 'put',
				handlers: [validateParamsWhenId('id')],
			},
			find: {
				path: '',
				method: 'get',
			},
			statusUpdate: {
				path: '/:id/status/:status',
				method: 'patch',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenEnum({
						status: Object.values(InvoiceStatusEnum),
					}),
				],
			},
			raiseForCashFlow: {
				path: '/from-cash-flow/:cash_flow_id',
				method: 'post',
				handlers: [validateParamsWhenId('cash_flow_id')],
			},
			reverse: {
				path: '/:id/reverse',
				method: 'post',
				handlers: [validateParamsWhenId('id')],
			},
			lineCreate: {
				path: '/:id/lines',
				method: 'post',
				handlers: [validateParamsWhenId('id')],
			},
			lineUpdate: {
				path: '/:id/lines/:line_id',
				method: 'put',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenId('line_id'),
				],
			},
			lineDelete: {
				path: '/:id/lines/:line_id',
				method: 'delete',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenId('line_id'),
				],
			},
			paymentCreate: {
				path: '/:id/payments',
				method: 'post',
				handlers: [validateParamsWhenId('id')],
			},
			paymentClear: {
				path: '/:id/payments',
				method: 'delete',
				handlers: [validateParamsWhenId('id')],
			},
			paymentDelete: {
				path: '/:id/payments/:payment_id',
				method: 'delete',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenId('payment_id'),
				],
			},
		},
	};

	return config;
};
