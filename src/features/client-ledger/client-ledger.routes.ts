import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { clientLedgerController } = await import(
		'@/features/client-ledger/client-ledger.controller'
	);

	const config: FeatureRoutesModule<typeof clientLedgerController> = {
		basePath: '/client-ledger',
		controller: clientLedgerController,
		routes: {
			balance: {
				path: '/:client_id',
				method: 'get',
				handlers: [validateParamsWhenId('client_id')],
			},
			find: {
				path: '/:client_id/entries',
				method: 'get',
				handlers: [validateParamsWhenId('client_id')],
			},
		},
	};

	return config;
};
