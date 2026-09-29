export const CashFlowCategoryEnum = {
	// Revenue
	SALE: 'sale', // When company receives money for something it sold

	// Business Expenses
	VENDOR: 'vendor', // Third-party services
	INSURANCE: 'insurance',
	TAXES: 'taxes',

	// Correction
	REFUND: 'refund',
} as const;

export type CashFlowCategory =
	(typeof CashFlowCategoryEnum)[keyof typeof CashFlowCategoryEnum];
