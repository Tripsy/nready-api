import { Configuration } from '@/config/settings.config';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import {
	ShippingMethodEnum,
	ShippingScopeEnum,
} from '@/features/shipping/shipping.entity';
import {
	quoteShipping,
	withShippingTotals,
} from '@/features/shipping/shipping-rate.service';

/*
 * Expectations are derived from the configured table rather than hard-coded, so an environment that
 * overrides a rate still tests the rule rather than the number. The defaults (25 / 50 RON, 15 / 15 /
 * 30, 21% VAT) are what the comments describe.
 */
const settings = Configuration.get('shipping');
const vatRate = Configuration.get('vat.standard');
const net = (gross: number) =>
	Math.round((gross / (1 + vatRate / 100)) * 100) / 100;

describe('quoteShipping', () => {
	it('charges a domestic courier delivery the domestic rate, split into net at standard VAT', () => {
		expect(
			quoteShipping({
				scope: ShippingScopeEnum.DELIVERY,
				method: ShippingMethodEnum.COURIER,
				countryCode: settings.domesticCountry.toLowerCase(),
				exchangeRate: 1,
			}),
		).toEqual({
			price: net(settings.price.domestic),
			vat_rate: vatRate,
			operational_cost: settings.operationalCost.delivery,
		});
	});

	it('charges an address in another country the international rate', () => {
		const quote = quoteShipping({
			scope: ShippingScopeEnum.DELIVERY,
			method: ShippingMethodEnum.COURIER,
			countryCode: 'HU',
			exchangeRate: 1,
		});

		expect(quote.price).toBe(net(settings.price.international));
	});

	it('charges an address that resolves to no country the international rate', () => {
		const quote = quoteShipping({
			scope: ShippingScopeEnum.DELIVERY,
			method: ShippingMethodEnum.COURIER,
			countryCode: null,
			exchangeRate: 1,
		});

		expect(quote.price).toBe(net(settings.price.international));
	});

	it('prices a return like a delivery, with the return operational cost', () => {
		expect(
			quoteShipping({
				scope: ShippingScopeEnum.RETURN,
				method: ShippingMethodEnum.COURIER,
				countryCode: settings.domesticCountry,
				exchangeRate: 1,
			}),
		).toEqual({
			price: net(settings.price.domestic),
			vat_rate: vatRate,
			operational_cost: settings.operationalCost.return,
		});
	});

	it('charges nothing for a relocation but keeps its operational cost', () => {
		expect(
			quoteShipping({
				scope: ShippingScopeEnum.RELOCATION,
				method: ShippingMethodEnum.COURIER,
				countryCode: null,
				exchangeRate: 1,
			}),
		).toEqual({
			price: 0,
			vat_rate: vatRate,
			operational_cost: settings.operationalCost.relocation,
		});
	});

	it('makes a self pickup free, with no operational cost', () => {
		expect(
			quoteShipping({
				scope: ShippingScopeEnum.DELIVERY,
				method: ShippingMethodEnum.SELF_PICKUP,
				countryCode: settings.domesticCountry,
				exchangeRate: 1,
			}),
		).toEqual({ price: 0, vat_rate: vatRate, operational_cost: 0 });
	});

	it('converts the base-currency price into the sale currency', () => {
		const quote = quoteShipping({
			scope: ShippingScopeEnum.DELIVERY,
			method: ShippingMethodEnum.COURIER,
			countryCode: settings.domesticCountry,
			exchangeRate: 5,
		});

		expect(quote.price).toBe(net(settings.price.domestic / 5));
	});
});

describe('withShippingTotals', () => {
	it('grosses a domestic quote back up to the configured VAT-inclusive price', () => {
		const pricing = withShippingTotals(
			quoteShipping({
				scope: ShippingScopeEnum.DELIVERY,
				method: ShippingMethodEnum.COURIER,
				countryCode: settings.domesticCountry,
				exchangeRate: 1,
			}),
			null,
			0,
		);

		expect(pricing.total).toBe(settings.price.domestic);
	});

	it('charges VAT after the discount', () => {
		const snapshot = { reduction: 10 } as DiscountSnapshot;
		const pricing = withShippingTotals(
			{ price: 20, vat_rate: 21, operational_cost: 15 },
			[snapshot],
			10,
		);

		expect(pricing).toMatchObject({
			discount_reduction: 10,
			vat_amount: 2.1,
			total: 12.1,
		});
	});

	it('comes to zero when the discount takes the whole price', () => {
		const pricing = withShippingTotals(
			{ price: 20.66, vat_rate: 21, operational_cost: 15 },
			null,
			20.66,
		);

		expect(pricing.total).toBe(0);
	});
});
