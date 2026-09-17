import { Configuration } from '@/config/settings.config';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import {
	type DiscountResolutionService,
	discountResolutionService,
} from '@/features/discount/discount-resolution.service';
import {
	type ShippingMethod,
	ShippingMethodEnum,
	type ShippingScope,
	ShippingScopeEnum,
} from '@/features/shipping/shipping.entity';
import { roundMoney } from '@/helpers/shop.helper';

/** What a movement costs before any discount. */
export type ShippingQuote = {
	/** Excluding VAT, in the sale currency. */
	price: number;
	vat_rate: number;
	/** The business's own estimate, in the base currency. */
	operational_cost: number;
};

/** A quote with the shipping discount applied - the figures a shipment row is written with. */
export type ShippingPricing = ShippingQuote & {
	discount: DiscountSnapshot[] | null;
	/** Money off `price`, excluding VAT, sale currency. */
	discount_reduction: number;
	/** VAT on `price - discount_reduction`. */
	vat_amount: number;
	/** What the client pays, VAT included. */
	total: number;
};

export type ShippingQuoteInput = {
	scope: ShippingScope;
	method: ShippingMethod;
	/** ISO 3166-1 alpha-2 of the client address the goods travel to or from; null when unresolved. */
	countryCode: string | null;
	/** Rate to the base currency, as on `shipping.exchange_rate` - `sale = base / rate`. */
	exchangeRate: number;
};

/**
 * The flat-rate table from `settings.shipping`, as figures for one movement.
 *
 * - A **relocation** is internal - nobody is charged - but still costs the business to carry out.
 * - A **self-pickup** moves nothing: free, and no operational cost either.
 * - A **courier delivery or return** is charged the domestic rate when the client address is in
 *   `domesticCountry`, the international one otherwise.
 *
 * ⚠️ **An address that resolves to no country is charged the international rate.** Domestic is a
 * claim the address has to prove; quoting the cheaper figure for an address nobody can place would
 * undercharge every incomplete one.
 *
 * The configured price is VAT-inclusive and in the base currency, so it is converted first and then
 * split into a net price at the standard rate - the net is what the row stores, and grossing it back
 * up lands on the configured figure to the cent.
 */
export function quoteShipping(input: ShippingQuoteInput): ShippingQuote {
	const settings = Configuration.get('shipping');
	const vatRate = Configuration.get('vat.standard');

	if (input.scope === ShippingScopeEnum.RELOCATION) {
		return {
			price: 0,
			vat_rate: vatRate,
			operational_cost: settings.operationalCost.relocation,
		};
	}

	if (input.method === ShippingMethodEnum.SELF_PICKUP) {
		return { price: 0, vat_rate: vatRate, operational_cost: 0 };
	}

	const isDomestic =
		input.countryCode !== null &&
		input.countryCode.toUpperCase() === settings.domesticCountry;

	const grossInBase = isDomestic
		? settings.price.domestic
		: settings.price.international;
	const grossInSale = grossInBase / (input.exchangeRate || 1);

	return {
		price: roundMoney(grossInSale / (1 + vatRate / 100)),
		vat_rate: vatRate,
		operational_cost:
			input.scope === ShippingScopeEnum.RETURN
				? settings.operationalCost.return
				: settings.operationalCost.delivery,
	};
}

/** Rounded the way `OrderService.computeTotals` rounds a line: VAT after the reduction. */
export function withShippingTotals(
	quote: ShippingQuote,
	discount: DiscountSnapshot[] | null,
	discountReduction: number,
): ShippingPricing {
	const net = roundMoney(quote.price - discountReduction);
	const vatAmount = roundMoney((net * quote.vat_rate) / 100);

	return {
		...quote,
		discount: discount,
		discount_reduction: discountReduction,
		vat_amount: vatAmount,
		total: roundMoney(net + vatAmount),
	};
}

export class ShippingRateService {
	constructor(
		private clientAddressService: ClientAddressService,
		private discountResolution: DiscountResolutionService,
	) {}

	/**
	 * The client address a movement's rate is judged by: where a delivery goes, where a return comes
	 * from. A relocation has none.
	 */
	public async resolveCountryCode(
		clientAddressId: number | null | undefined,
	): Promise<string | null> {
		return clientAddressId
			? this.clientAddressService.getCountryCodeById(clientAddressId)
			: null;
	}

	/**
	 * The figures a checkout shipment is written with: the flat rate, then the best `shipping`
	 * discount for this buyer.
	 *
	 * `countryCode` on the context is the **billing** country, for `applicable_countries` - the same
	 * buyer country the goods passes judge - while the rate itself is decided by the destination.
	 * `orderValue` is the goods subtotal before discounts, sale currency, for `min_order_value`.
	 */
	public async priceForBuyer(
		input: ShippingQuoteInput,
		buyer: {
			clientId: number | null;
			countryCode: string | null;
			orderValue: number;
			now?: Date;
		},
	): Promise<ShippingPricing> {
		const quote = quoteShipping(input);

		const resolved = await this.discountResolution.resolveForShipping({
			clientId: buyer.clientId,
			countryCode: buyer.countryCode,
			orderValue: buyer.orderValue,
			// The rate that converted the price also converts an `amount` rule and the threshold
			exchangeRate: input.exchangeRate,
			now: buyer.now,
			price: quote.price,
		});

		return withShippingTotals(
			quote,
			resolved ? [resolved.snapshot] : null,
			resolved?.reduction ?? 0,
		);
	}
}

export const shippingRateService = new ShippingRateService(
	clientAddressService,
	discountResolutionService,
);
