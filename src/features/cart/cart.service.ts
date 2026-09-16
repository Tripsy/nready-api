import { createHash, randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, NotFoundError } from '@/exceptions';
import CartEntity, { CART_TTL_SECONDS } from '@/features/cart/cart.entity';
import {
	getCartItemRepository,
	getCartRepository,
} from '@/features/cart/cart.repository';
import type { CartValidator } from '@/features/cart/cart.validator';
import CartItemEntity from '@/features/cart/cart-item.entity';
import {
	type CartLine,
	type CartPricing,
	type CartPricingService,
	cartPricingService,
} from '@/features/cart/cart-pricing.service';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import { ClientAddressTypeEnum } from '@/features/client-address/client-address.entity';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import type OrderEntity from '@/features/order/order.entity';
import {
	type OrderLineInput,
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import ProductEntity, {
	ProductCompositionEnum,
	ProductTypeEnum,
} from '@/features/product/product.entity';
import {
	type BundleChoice,
	type BundleSelectionProblem,
	ProductBundleSelectionService,
	productBundleSelectionService,
} from '@/features/product/product-bundle-selection.service';
import {
	ProductOptionSelectionService,
	productOptionSelectionService,
} from '@/features/product/product-option-selection.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import {
	ShippingMethodEnum,
	ShippingScopeEnum,
} from '@/features/shipping/shipping.entity';
import {
	type ShippingService,
	shippingService,
} from '@/features/shipping/shipping.service';
import {
	type WarehouseService,
	warehouseService,
} from '@/features/warehouse/warehouse.service';
import { createFutureDate } from '@/helpers/date.helper';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/** A cart plus what it currently costs - the only shape the storefront is ever handed. */
export type CartWithPricing = {
	id: number;
	token: string;
	currency: string;
	user_id: number | null;
	expires_at: Date;
	pricing: CartPricing;
};

/**
 * The canonical form of a line's option set, and half of what `UQ_cart_item_line` compares.
 *
 * Sorted and de-duplicated before hashing, so `[3, 1]` and `[1, 3, 3]` are recognized as the same
 * choice and increment one line instead of creating three. An empty set hashes to the empty
 * string rather than to the hash of nothing, because the column is `NOT NULL` and a sentinel that
 * reads as "no options" beats one that reads as a hash nobody can reproduce.
 */
export function normalizeOptions(options?: number[] | null): {
	options: number[] | null;
	hash: string;
} {
	const unique = [...new Set(options ?? [])].sort(
		(first, second) => first - second,
	);

	if (unique.length === 0) {
		return { options: null, hash: '' };
	}

	return {
		options: unique,
		hash: createHash('sha256').update(unique.join(',')).digest('hex'),
	};
}

/**
 * The whole of a line's identity: its options **and**, for a bundle, how it was configured.
 *
 * `options_hash` is what `UQ_cart_item_line` compares, and a bundle header names the same variant
 * however it was put together - so hashing the options alone would fold a menu with large fries
 * into one already holding a menu with small fries and quietly sum their quantities. Folding the
 * component picks in is what keeps two configurations two lines, while re-adding the same
 * configuration still increments the one it matches.
 *
 * Picks are sorted by component id and carry their unit count, since taking two desserts is a
 * different line from taking one. A line with no components hashes exactly as it did before, so
 * every ordinary line keeps the identity it already had.
 */
export function buildLineHash(
	options: number[] | null,
	components?: readonly BundleChoice[] | null,
): string {
	const optionPart = (options ?? []).join(',');

	const componentPart = [...(components ?? [])]
		.map((choice) => `${choice.item_id}:${choice.units ?? 1}`)
		.sort()
		.join(',');

	if (optionPart === '' && componentPart === '') {
		return '';
	}

	return createHash('sha256')
		.update(`${optionPart}|${componentPart}`)
		.digest('hex');
}

/**
 * The message a rejected bundle selection reads as.
 *
 * Kept beside the caller rather than in the selection service for the reason that service returns
 * a problem instead of throwing one: the cart refuses an add with these words, while the pricing
 * pass reports the same finding as a line issue and says it differently.
 */
function bundleProblemMessage(problem: BundleSelectionProblem): string {
	switch (problem.reason) {
		case 'foreign_component':
			return lang('cart.error.bundle_component_invalid');
		case 'included_component':
			return lang('cart.error.bundle_component_included');
		case 'group_unanswered':
			return lang('cart.error.bundle_group_unanswered');
		case 'group_multiple':
			return lang('cart.error.bundle_group_multiple');
		case 'over_ceiling':
			return lang('cart.error.bundle_component_ceiling', {
				max: String(problem.max),
			});
	}
}

/**
 * The priced basket as the order wants it: a flat list of what the shopper added, each bundle
 * header carrying the components it explodes into.
 *
 * The figures are copied rather than recomputed. The cart has already apportioned a bundle across
 * its components at their own VAT rates, and that is the split the shopper was just quoted - so
 * the document records it instead of deriving a second one that might differ by a cent.
 *
 * A header reaches `order_line` at `price: 0`, which its `price >= 0` check allows for exactly
 * this shape (`product.md` §8.3).
 */
function toOrderLines(lines: readonly CartLine[]): OrderLineInput[] {
	const childrenByParent = new Map<number, CartLine[]>();

	for (const line of lines) {
		if (line.parent_id === null) {
			continue;
		}

		const list = childrenByParent.get(line.parent_id) ?? [];

		list.push(line);
		childrenByParent.set(line.parent_id, list);
	}

	const asInput = (line: CartLine): Omit<OrderLineInput, 'children'> => ({
		variant_id: line.variant_id,
		product_id: line.product_id,
		quantity: line.quantity,
		// `unit_price`, not `total`: the order stores a unit figure and the discount that
		// applied to it separately, so the reduction stays visible on the invoice instead of
		// disappearing into the price.
		price: line.unit_price,
		vat_rate: line.vat_rate,
		discount: line.discount,
		discount_reduction: line.discount_reduction,
		options: line.options,
		notes: line.notes,
	});

	return lines
		.filter((line) => line.parent_id === null)
		.map((line) => {
			const children = childrenByParent.get(line.id) ?? [];

			return {
				...asInput(line),
				...(children.length > 0
					? { children: children.map(asInput) }
					: {}),
			};
		});
}

/**
 * What physically travels for an order, as shipping lines.
 *
 * - **A bundle header is left out and its components kept.** The header holds no stock - it names
 *   what was sold - while each component line is a real variant with its quantity already
 *   multiplied out by the bundle's.
 * - **Only physical products travel.** A digital product or a service is fulfilled some other way,
 *   and a parcel listing one would have nothing to pick.
 * - **One line per variant.** The same variant can sit on two cart lines (with different options,
 *   or standalone beside a bundle that contains it), and `shipping_line` holds one row per variant,
 *   so the quantities are summed.
 */
function toShippingLines(
	lines: readonly CartLine[],
	physicalProductIds: ReadonlySet<number>,
): { variant_id: number; product_id: number; quantity: number }[] {
	const byVariant = new Map<
		number,
		{ variant_id: number; product_id: number; quantity: number }
	>();

	for (const line of lines) {
		if (line.is_bundle || !physicalProductIds.has(line.product_id)) {
			continue;
		}

		const existing = byVariant.get(line.variant_id);

		if (existing) {
			existing.quantity += Number(line.quantity);
		} else {
			byVariant.set(line.variant_id, {
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: Number(line.quantity),
			});
		}
	}

	return [...byVariant.values()];
}

export class CartService {
	constructor(
		private repository: ReturnType<typeof getCartRepository>,
		private itemRepository: ReturnType<typeof getCartItemRepository>,
		private pricing: CartPricingService,
		private orderService: OrderService,
		private clientService: ClientService,
		private optionSelection: ProductOptionSelectionService,
		private bundleSelection: ProductBundleSelectionService,
		private warehouseService: WarehouseService,
		private clientAddressService: ClientAddressService,
		private shippingService: ShippingService,
	) {}

	/**
	 * The cart a request belongs to, created when there is none.
	 *
	 * The account wins over the token whenever both are present: a signed-in shopper has exactly
	 * one cart by `UQ_cart_user`, and honoring a stale cookie instead would let a second tab write
	 * to a cart the first one cannot see. `merge` is what reconciles the two, and it is called
	 * from here so signing in with a full guest cart never loses it.
	 */
	public async resolve(
		token: string | null,
		userId: number | null,
		currency: string = Configuration.currency(),
	): Promise<CartEntity> {
		if (userId) {
			if (token) {
				const merged = await this.merge(token, userId);

				if (merged) {
					return merged;
				}
			}

			const existing = await this.repository
				.createQuery()
				.filterBy('user_id', userId)
				.first();

			if (existing) {
				return existing;
			}
		}

		if (token) {
			const existing = await this.repository
				.createQuery()
				.filterBy('token', token)
				.first();

			if (existing) {
				return existing;
			}
		}

		return this.create(userId, currency);
	}

	private async create(
		userId: number | null,
		currency: string,
	): Promise<CartEntity> {
		const entry = this.repository.create({
			token: randomUUID(),
			user_id: userId,
			currency: currency,
			expires_at: createFutureDate(CART_TTL_SECONDS),
		});

		return this.repository.save(entry);
	}

	/**
	 * The cart a caller may write to, or a 404.
	 *
	 * The handle is the whole address, so there is no ownership check left for a later step to
	 * forget: a token naming somebody else's cart and a token naming a cart that has already
	 * checked out are the same answer - not found, because the row is gone.
	 */
	public async findWritable(
		token: string,
		userId: number | null,
	): Promise<CartEntity> {
		const query = this.repository.createQuery();

		if (userId) {
			query.filterBy('user_id', userId);
		} else {
			query.filterBy('token', token);
		}

		const entry = await query.first();

		if (!entry) {
			throw new NotFoundError(lang('cart.error.not_found'));
		}

		return entry;
	}

	/**
	 * Claims a guest cart for an account at login.
	 *
	 * Quantities are summed on collision rather than overwritten: both baskets were built
	 * deliberately, and the shopper can lower a number far more easily than they can remember what
	 * the other tab held. Lines that exist only on one side move across untouched, and the guest
	 * cart is deleted once it has been emptied into the member's - it is not a second basket the
	 * shopper still has, so leaving it behind would only hold a token that resolves to nothing.
	 *
	 * Returns null when there is nothing to merge, which is the common case - most sign-ins happen
	 * with an empty guest cart or none at all.
	 */
	public async merge(
		guestToken: string,
		userId: number,
	): Promise<CartEntity | null> {
		const guestCart = await this.repository
			.createQuery()
			.filterBy('token', guestToken)
			.first();

		if (!guestCart || guestCart.user_id === userId) {
			return guestCart;
		}

		// Somebody else's cart. The cookie is stale or forged; either way it is not this
		// account's to claim, and answering with their own cart is the safe outcome.
		if (guestCart.user_id !== null) {
			return null;
		}

		const memberCart = await this.repository
			.createQuery()
			.filterBy('user_id', userId)
			.first();

		if (!memberCart) {
			// Nothing to fold into - the guest cart simply becomes the member's, which keeps its
			// token valid and costs no row copying.
			guestCart.user_id = userId;
			guestCart.expires_at = createFutureDate(CART_TTL_SECONDS);

			return this.repository.save(guestCart);
		}

		await dataSource.transaction(async (manager) => {
			const guestItems = await manager.find(CartItemEntity, {
				where: { cart_id: guestCart.id },
			});
			const memberItems = await manager.find(CartItemEntity, {
				where: { cart_id: memberCart.id },
			});

			const byLine = new Map(
				memberItems.map((item) => [
					`${item.variant_id}:${item.options_hash}`,
					item,
				]),
			);

			for (const item of guestItems) {
				const key = `${item.variant_id}:${item.options_hash}`;
				const existing = byLine.get(key);

				if (existing) {
					existing.quantity += item.quantity;

					await manager.save(existing);

					continue;
				}

				item.cart_id = memberCart.id;

				await manager.save(item);
			}

			memberCart.expires_at = createFutureDate(CART_TTL_SECONDS);

			await manager.save(memberCart);

			/*
			 * Deleted by id rather than by entity: the lines worth keeping have already been
			 * reassigned above, and the ones left are the collisions whose quantity the member's
			 * own line absorbed. `cart_item.cart_id` cascades, so they go with it in one
			 * statement - inside this transaction, so a failed move never strands a cart.
			 */
			await manager.delete(CartEntity, guestCart.id);
		});

		return memberCart;
	}

	/**
	 * Adds a line, or raises the quantity of the one already holding the same configuration.
	 *
	 * The upsert is decided on the normalized option hash rather than on the ids as sent, so the
	 * same choice reaches the same row however the client ordered it.
	 *
	 * The *option* choice is checked before anything is written: every answer has to be one of the
	 * product's, and every question it asks answered within its bounds (`product.md` §10.2-3). A
	 * line that fails either would price with the wrong delta, or reach an order an operator cannot
	 * save. A line merged into an existing one carries the same set, so it was checked already.
	 *
	 * Bundle components are neither checked nor accepted: there is no bundle analogue of
	 * `ProductOptionSelectionService`, and a bundle reaches the cart as a flat line on its header
	 * variant with its components unrecorded - `product.md` §8.5.
	 */
	public async addItem(
		cart: CartEntity,
		data: ValidatorOutput<CartValidator, 'addItem'>,
	): Promise<CartItemEntity> {
		const { options } = normalizeOptions(data.options);
		const hash = buildLineHash(options, data.components);

		const groups = await this.optionSelection.loadGroups([data.product_id]);

		const problem = ProductOptionSelectionService.findProblem(
			groups.get(data.product_id) ?? [],
			options ?? [],
		);

		if (problem?.reason === 'foreign_option') {
			throw new BadRequestError(lang('cart.error.invalid_option'));
		}

		if (problem?.reason === 'selection') {
			throw new BadRequestError(
				lang('cart.error.option_selection', {
					min: String(problem.min),
					max: problem.max === null ? 'any' : String(problem.max),
				}),
			);
		}

		const components = await this.resolveComponents(data);

		const match = this.itemRepository
			.createQuery()
			.filterBy('cart_id', cart.id)
			.filterBy('variant_id', data.variant_id)
			.filterBy('options_hash', hash);

		/*
		 * Dropped to the builder because `filterBy` returns early on a null value, so it cannot
		 * express "is null" at all - the same reason `CategoryService` writes this clause by hand.
		 * Without it the lookup would match a component row carrying this variant and increment
		 * somebody's bundle instead of adding a line.
		 */
		match.getQuery().andWhere('cart_item.parent_id IS NULL');

		const existing = await match.first();

		/*
		 * The same configuration increments the line already holding it, components and all - the
		 * hash covers them, so a match here is a match on the whole bundle and its existing
		 * component rows still describe it correctly.
		 */
		if (existing) {
			existing.quantity += data.quantity;
			existing.notes = data.notes ?? existing.notes;

			const saved = await this.itemRepository.save(existing);

			await this.touch(cart);

			return saved;
		}

		const header = this.itemRepository.create({
			cart_id: cart.id,
			variant_id: data.variant_id,
			product_id: data.product_id,
			quantity: data.quantity,
			options: options,
			options_hash: hash,
			notes: data.notes ?? null,
			parent_id: null,
			bundle_item_id: null,
		});

		if (components === null) {
			const saved = await this.itemRepository.save(header);

			await this.touch(cart);

			return saved;
		}

		/*
		 * Header and components in one transaction: a bundle half-written is a line quoting a kit
		 * it does not contain, and the component rows need the header's generated id.
		 */
		const saved = await dataSource.transaction(async (manager) => {
			const parent = await manager.save(header);

			await manager.save(
				components.map((component) =>
					manager.create(CartItemEntity, {
						cart_id: cart.id,
						parent_id: parent.id,
						bundle_item_id: component.item.id,
						variant_id: component.item.variant_id,
						// The component's own product, not the bundle's - the composite foreign
						// key points at `product_variant (id, product_id)`, and pricing reads the
						// VAT class and the discount target from it.
						product_id: component.productId,
						// Units per one bundle; the header's own quantity multiplies it.
						quantity: component.units,
						options: null,
						options_hash: '',
						notes: null,
					}),
				),
			);

			return parent;
		});

		await this.touch(cart);

		return saved;
	}

	/**
	 * The component rows a line should carry, or null when the product is not a bundle.
	 *
	 * Everything the shopper may decide is settled here rather than at pricing time: a simple
	 * product refuses components outright, and a bundle's picks have to answer its composition
	 * exactly - every group once, every tick box within its ceiling, nothing named that comes with
	 * the kit. `product.md` §8.1 is the whole of the rule and
	 * `ProductBundleSelectionService.findProblem` is the whole of the check.
	 *
	 * The components that are always included are added here rather than sent by the client: they
	 * are catalog data, and a payload that could state them could state a kit the bundle does not
	 * have.
	 */
	private async resolveComponents(
		data: ValidatorOutput<CartValidator, 'addItem'>,
	): Promise<
		| null
		| {
				item: { id: number; variant_id: number };
				productId: number;
				units: number;
		  }[]
	> {
		const product = await dataSource.getRepository(ProductEntity).findOne({
			select: { id: true, composition: true },
			where: { id: data.product_id },
		});

		const chosen = data.components ?? [];

		if (!product || product.composition !== ProductCompositionEnum.BUNDLE) {
			if (chosen.length > 0) {
				throw new BadRequestError(lang('cart.error.not_a_bundle'));
			}

			return null;
		}

		const compositions = await this.bundleSelection.loadComposition([
			data.product_id,
		]);

		const composition = compositions.get(data.product_id);

		if (!composition) {
			return null;
		}

		const trouble = ProductBundleSelectionService.findProblem(
			composition,
			chosen,
		);

		if (trouble) {
			throw new BadRequestError(bundleProblemMessage(trouble));
		}

		const resolved = ProductBundleSelectionService.resolve(
			composition,
			chosen,
		);

		/*
		 * The component's own product, read in one go for the whole set: `cart_item` holds the
		 * pair under a composite foreign key, and a component names a variant of some other
		 * product than the bundle by definition.
		 */
		const variantIds = resolved.map(
			(component) => component.item.variant_id,
		);

		const variants =
			variantIds.length === 0
				? []
				: await dataSource.getRepository(ProductVariantEntity).find({
						select: { id: true, product_id: true },
						where: { id: In(variantIds) },
					});

		const productByVariant = new Map(
			variants.map((variant) => [variant.id, variant.product_id]),
		);

		return resolved.map((component) => {
			const productId = productByVariant.get(component.item.variant_id);

			if (productId === undefined) {
				// The `product_bundle_item.variant_id` foreign key is RESTRICT, so this is a
				// catalog that changed under a read rather than a state the schema allows.
				throw new BadRequestError(lang('cart.error.bundle_changed'));
			}

			return {
				item: component.item,
				productId: productId,
				units: component.units,
			};
		});
	}

	/**
	 * Changes a line's quantity or note. The options are not editable: a different option set is a
	 * different line by `UQ_cart_item_line`, so changing them here would either collide with an
	 * existing row or silently merge two lines the shopper still sees as separate. The client
	 * removes and re-adds instead.
	 */
	public async updateItem(
		cart: CartEntity,
		data: ValidatorOutput<CartValidator, 'updateItem'>,
	): Promise<CartItemEntity> {
		const entry = await this.itemRepository
			.createQuery()
			.filterBy('cart_id', cart.id)
			.filterById(data.id)
			.first();

		if (!entry) {
			throw new NotFoundError(lang('cart.error.item_not_found'));
		}

		/*
		 * A component is not a line the shopper owns: what the bundle contains was decided when it
		 * was added, and its quantity is per bundle, so raising it here would mean something
		 * different from raising the bundle's. The header is the editable row.
		 */
		if (entry.parent_id !== null) {
			throw new BadRequestError(lang('cart.error.component_locked'));
		}

		if (data.quantity !== undefined) {
			entry.quantity = data.quantity;
		}

		if (data.notes !== undefined) {
			entry.notes = data.notes;
		}

		const saved = await this.itemRepository.save(entry);

		await this.touch(cart);

		return saved;
	}

	public async removeItem(cart: CartEntity, itemId: number): Promise<void> {
		// Checked before the delete rather than after: `RepositoryAbstract.delete` throws its own
		// generic not-found, and a line the shopper already removed in another tab should read as
		// this feature's message rather than as a bare `cart_item.error.not_found`.
		const entry = await this.itemRepository
			.createQuery()
			.filterBy('cart_id', cart.id)
			.filterById(itemId)
			.first();

		if (!entry) {
			throw new NotFoundError(lang('cart.error.item_not_found'));
		}

		// Taking one component out would leave a bundle that is not the bundle any more. Removing
		// the header is what removes the whole thing, its components following through the cascade.
		if (entry.parent_id !== null) {
			throw new BadRequestError(lang('cart.error.component_locked'));
		}

		await this.itemRepository
			.createQuery()
			.filterBy('cart_id', cart.id)
			.filterById(itemId)
			.delete(false, false);

		await this.touch(cart);
	}

	/** Emptying an already-empty cart is a no-op, not a 404 - the caller asked for a state, not a row. */
	public async clear(cart: CartEntity): Promise<void> {
		const count = await this.itemRepository
			.createQuery()
			.filterBy('cart_id', cart.id)
			.count();

		if (count > 0) {
			await this.itemRepository
				.createQuery()
				.filterBy('cart_id', cart.id)
				.delete(false, true);
		}

		await this.touch(cart);
	}

	/**
	 * Repricing the whole cart into another market. Nothing is stored per line, so this is a
	 * single column - which is exactly the property the cart/order split was chosen for.
	 */
	public async setCurrency(
		cart: CartEntity,
		currency: string,
	): Promise<CartEntity> {
		cart.currency = currency;

		return this.touch(cart);
	}

	/** Slides the expiry forward. Every write goes through it, so a cart in use never expires. */
	private async touch(cart: CartEntity): Promise<CartEntity> {
		cart.expires_at = createFutureDate(CART_TTL_SECONDS);

		return this.repository.save(cart);
	}

	/**
	 * Every row of the cart, each bundle header immediately followed by its own components.
	 *
	 * The grouping is what lets the pricing pass walk the list once instead of indexing it: the
	 * sort key is the header's id for a header and for each of its children alike, so a bundle
	 * arrives as a contiguous run in the order the components were written.
	 */
	public async getItems(cartId: number): Promise<CartItemEntity[]> {
		const query = this.itemRepository
			.createQuery()
			.filterBy('cart_id', cartId);

		query
			.getQuery()
			.orderBy('COALESCE(cart_item.parent_id, cart_item.id)', 'ASC')
			// The header sorts ahead of its own components, which share its id as their key.
			.addOrderBy('cart_item.parent_id', 'ASC', 'NULLS FIRST')
			.addOrderBy('cart_item.id', 'ASC');

		return query.all();
	}

	/** The cart as the storefront sees it: the row, plus what it costs at this moment. */
	public async withPricing(
		cart: CartEntity,
		language?: string,
	): Promise<CartWithPricing> {
		const items = await this.getItems(cart.id);

		return {
			id: cart.id,
			token: cart.token,
			currency: cart.currency,
			user_id: cart.user_id,
			expires_at: cart.expires_at,
			pricing: await this.pricing.price(cart, items, language),
		};
	}

	/**
	 * Turns a cart into an order - the single point where the two models meet, and the only place
	 * a cart's prices stop moving.
	 *
	 * Everything happens in one transaction, and the series number is allocated inside it with the
	 * caller's manager, so an order that fails to write rolls the counter back with itself and the
	 * `ORD` series stays gapless.
	 *
	 * Prices are resolved once more here rather than reused from whatever the shopper was last
	 * shown. That read may be minutes or weeks old, and the figures written to `order_line` are
	 * the ones that will be invoiced - so they are taken at the moment of commitment, and the
	 * result is what the confirmation screen reports back.
	 *
	 * The cart is deleted in the same transaction, its lines with it through the cascade. Once the
	 * order exists there is nothing left for the cart to say: the order carries what was bought at
	 * the figures it was bought at, while the cart would only carry the same references priced
	 * against tomorrow's catalog. The shopper's next visit starts a fresh one.
	 *
	 * What the order *is* - the series allocation, the starting status, the line layout - belongs
	 * to `OrderService`. This method's job is the translation: decide the figures, hand them over,
	 * and clear the basket they came from.
	 *
	 * The client has to be one the buyer holds. Billing somebody else's client would put an order
	 * on their books, and - since a review is verified through the author's clients - hand them a
	 * verified-buyer badge for a purchase they never made. Somebody else's client answers the
	 * same 404 a missing one does.
	 *
	 * **The delivery choice becomes the order's first `shipping` row**, written through
	 * `ShippingService.createWithin` in the same transaction, so an order never exists without
	 * saying how it travels and the row obeys the rules a back-office create does. It leaves from
	 * the active default warehouse, carries every physical item of the order (`toShippingLines`),
	 * and is priced at zero: no shipping rate exists yet to charge from, which is also what the
	 * basket quotes. The client's contact details are copied onto it.
	 *
	 * An order with nothing physical in it - only digital products or services - raises no
	 * shipment: there is nothing to pick, and an empty parcel would sit in the dispatch queue.
	 *
	 * **Both addresses are referenced, not copied** - `order.billing_address_id` and the shipment's
	 * `destination_client_address_id`. They have to be filed under the billed client with the
	 * matching type; anything else is the client-address 404. The destination is frozen into
	 * `shipping.destination_data` when the shipment ships, which is the point after which
	 * re-addressing a parcel already on its way would be a lie.
	 */
	public async toOrder(
		cart: CartEntity,
		data: ValidatorOutput<CartValidator, 'checkout'>,
		userId: number,
		language?: string,
	): Promise<OrderEntity> {
		const client = await this.clientService.findOwnById(
			data.client_id,
			userId,
		);

		/*
		 * Resolved for what they prove, not for what they return: each call refuses an address that
		 * is not filed under this client with the matching type, which is the whole ownership check
		 * behind the two ids below. The rows themselves are referenced, not copied.
		 */
		await this.clientAddressService.getOrderSnapshot(
			data.billing_address_id,
			client.id,
			ClientAddressTypeEnum.BILLING,
		);

		const deliveryAddressId =
			data.delivery_method === ShippingMethodEnum.COURIER &&
			data.delivery_address_id
				? data.delivery_address_id
				: null;

		if (deliveryAddressId) {
			await this.clientAddressService.getOrderSnapshot(
				deliveryAddressId,
				client.id,
				ClientAddressTypeEnum.DELIVERY,
			);
		}

		const items = await this.getItems(cart.id);

		if (items.length === 0) {
			throw new BadRequestError(lang('cart.error.empty'));
		}

		const pricing = await this.pricing.price(cart, items, language);

		if (pricing.has_issues) {
			throw new BadRequestError(lang('cart.error.has_issues'));
		}

		/*
		 * Both resolved before the transaction opens: they are reads of committed configuration,
		 * and either one failing should refuse the checkout before a series number is spent. The
		 * rate is resolved once so the order lines and the shipment are frozen at the same figure.
		 */
		const warehouse = await this.warehouseService.findDefault();

		const physicalProducts = await dataSource
			.getRepository(ProductEntity)
			.find({
				select: { id: true },
				where: {
					id: In([
						...new Set(
							pricing.lines.map((line) => line.product_id),
						),
					]),
					type: ProductTypeEnum.PHYSICAL,
				},
			});

		const shippingLines = toShippingLines(
			pricing.lines,
			new Set(physicalProducts.map((product) => product.id)),
		);
		const exchangeRate = await this.orderService.resolveExchangeRate(
			pricing.currency,
		);

		return dataSource.transaction(async (manager) => {
			/*
			 * The manager is handed over so the whole thing is one transaction: the series
			 * number `OrderService` allocates rolls back with the cart delete below, and a cart
			 * can never disappear beside an order that failed to write.
			 */
			const order = await this.orderService.create(manager, {
				client_id: client.id,
				currency: pricing.currency,
				exchange_rate: exchangeRate,
				payment_method: data.payment_method,
				billing_address_id: data.billing_address_id,
				notes: data.notes ?? null,
				lines: toOrderLines(pricing.lines),
			});

			if (shippingLines.length > 0) {
				await this.shippingService.createWithin(manager, {
					// A checkout always produces the same kind of movement: stock leaving a
					// warehouse for the client. A relocation or a return is raised elsewhere
					scope: ShippingScopeEnum.DELIVERY,
					order_id: order.id,
					method: data.delivery_method,
					pickup_warehouse_id: warehouse.id,
					// Null for a pickup: the goods are collected from the warehouse
					destination_client_address_id:
						deliveryAddressId ?? undefined,
					price: 0,
					vat_rate: 0,
					currency: pricing.currency,
					exchange_rate: exchangeRate,
					contact_name:
						client.contact_name ??
						client.person_name ??
						client.company_name ??
						undefined,
					contact_phone: client.contact_phone ?? undefined,
					contact_email: client.contact_email ?? undefined,
					lines: shippingLines,
				});
			}

			// By id rather than by entity: `remove` would strip the id off the object the caller
			// still holds, and the lines go through the `cart_item.cart_id` cascade either way.
			await manager.delete(CartEntity, cart.id);

			return order;
		});
	}

	/**
	 * The cleanup sweep, called by `clean-cart.cron.ts`.
	 *
	 * One step: a cart nobody has touched since `expires_at` is deleted outright, its lines with
	 * it through the cascade. There is no intermediate state to pass through first - the row holds
	 * references and no money, so an expired basket is not a document that needs a retention
	 * window, and a shopper who comes back to it would be shown prices the sweep has already
	 * declared stale.
	 */
	public async cleanUp(): Promise<{ deleted: number }> {
		const now = new Date();

		const expired = await this.repository
			.createQuery()
			.filterByRange('expires_at', null, now)
			.count();

		/*
		 * `force` for the same reason every retention sweep in the codebase passes it
		 * (`clean-account-token`, `clean-log-data`, `clean-cron-history`): `hasFilter` is only
		 * raised by a filter on an id column, so a date-scoped delete reads as unfiltered and is
		 * refused. The where clause still applies - force skips the guard, not the filter.
		 *
		 * The count ahead of it is not the same guard: `delete` throws not-found when nothing
		 * matches, and an empty sweep is the normal outcome on most runs.
		 */
		const deleted =
			expired === 0
				? 0
				: await this.repository
						.createQuery()
						.filterByRange('expires_at', null, now)
						.delete(false, true, true);

		return { deleted: deleted };
	}

	/**
	 * Hard, like every other delete on this table. A cart removed from the back office is a
	 * support action against a basket somebody is still carrying, and there is nothing to restore
	 * it to - the shopper's next visit starts a new one.
	 */
	public async delete(id: number): Promise<number> {
		return this.repository
			.createQuery()
			.filterById(id)
			.delete(false, false);
	}

	public async findById(id: number): Promise<CartEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/** @description Used in `read` method from controller; this will return a custom shape */
	public async getEntryData(data: { id: number }) {
		const cart = await this.repository
			.createQuery()
			.filterById(data.id)
			.firstOrFail();

		return this.withPricing(cart as CartEntity);
	}

	public findByFilter(data: ValidatorOutput<CartValidator, 'find'>) {
		const query = this.repository
			.createQuery()
			.select([
				'id',
				'token',
				'user_id',
				'currency',
				'expires_at',
				'created_at',
				'updated_at',
			])
			.filterBy('user_id', data.filter.user_id)
			.filterBy('currency', data.filter.currency)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit);

		return query.all(true);
	}
}

export const cartService = new CartService(
	getCartRepository(),
	getCartItemRepository(),
	cartPricingService,
	orderService,
	clientService,
	productOptionSelectionService,
	productBundleSelectionService,
	warehouseService,
	clientAddressService,
	shippingService,
);
