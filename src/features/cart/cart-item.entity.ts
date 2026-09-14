import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import type CartEntity from '@/features/cart/cart.entity';
import type ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'cart_item';

/**
 * One line a shopper picked: which variant, how many, and which options they answered the
 * product's questions with.
 *
 * No `deleted_at`, for the same reason the cart has none - a line the shopper took out is not a
 * record anybody keeps, and every delete on this table is already a hard one. `EntityAbstract` is
 * therefore not extended; it carries a `@DeleteDateColumn`.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores cart lines; deliberately holds no prices',
})
@Check('CHK_cart_item_quantity', '(quantity > 0)')
/*
 * Re-adding the same configuration increments the line it matches rather than creating a second
 * one; a different set of options is a genuinely different line and gets its own row.
 *
 * The hash is what makes that expressible as an index - jsonb has no useful equality for this,
 * since `[3,1]` and `[1,3]` are the same choice written two ways. `CartService` normalizes and
 * hashes the ids, so the column is the canonical form of `options` and the two are written
 * together or not at all.
 *
 * **Scoped to the lines a shopper added directly.** A component row carries the same `variant_id`
 * as a standalone line of that variant would, so an unscoped key would have fries-inside-a-menu
 * collide with fries-on-their-own. Writing `parent_id` into the key instead would break the
 * dedupe it exists for: Postgres treats nulls in a unique index as distinct, so every ordinary
 * line would stop matching itself and re-adding would insert rather than increment.
 */
@Index('UQ_cart_item_line', ['cart_id', 'variant_id', 'options_hash'], {
	unique: true,
	where: 'parent_id IS NULL',
})
/*
 * A bundle contains a given component once. The partial predicate is what keeps this off the
 * ordinary lines, where both columns are null and the pair would say nothing.
 */
@Index('UQ_cart_item_component', ['parent_id', 'bundle_item_id'], {
	unique: true,
	where: 'parent_id IS NOT NULL',
})
// Reading a bundle line reads its components; the partial predicate keeps the index to the few
// rows that are components, since an ordinary cart is mostly not.
@Index('IDX_cart_item_parent_id', ['parent_id'], {
	where: 'parent_id IS NOT NULL',
})
export default class CartItemEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('int', { nullable: false })
	@Index('IDX_cart_item_cart_id')
	cart_id!: number;

	/**
	 * The bundle line this row is a component of; null on every line a shopper added directly.
	 *
	 * A bundle reaches the cart as a header naming the bundle's own variant plus one row per
	 * component, which is the shape `order_line` takes at checkout (`product.md` §8.3). The header
	 * is what the shopper sees and what `quantity` counts; the components record what the bundle
	 * was configured to contain.
	 */
	@Column('int', { nullable: true })
	parent_id!: number | null;

	/**
	 * Which `product_bundle_item` this row materializes, so the line can be read back against the
	 * live composition: which of §8.1's three cases it is, and which `product_bundle_item_price`
	 * delta applies. Null on a header and on every ordinary line.
	 *
	 * Without it a component row is just a variant, and nothing could tell a component that comes
	 * with the kit - covered by the bundle's price - from a ticked extra that adds to it.
	 */
	@Column('int', { nullable: true })
	bundle_item_id!: number | null;

	@Column('int', { nullable: false })
	@Index('IDX_cart_item_variant_id')
	variant_id!: number;

	/**
	 * Denormalized alongside `variant_id` and held to it by the composite foreign key below, the
	 * same arrangement `order_line` uses. Pricing needs the product on every line - for its VAT
	 * class, and as a discount target - and this saves a join to reach it.
	 */
	@Column('int', { nullable: false })
	product_id!: number;

	/*
	 * On a component row this is units **per one bundle**, not the absolute count. Two burger
	 * menus each containing one cheeseburger is a header at `quantity: 2` over a component at
	 * `quantity: 1`, and the multiplication happens when the line is priced.
	 *
	 * Absolute counts would have to be rewritten on every change of the header's quantity - the
	 * commonest cart operation there is - turning a one-row save into a transaction over the whole
	 * bundle. Checkout multiplies out once, where the figures stop moving anyway.
	 *
	 * `numeric` rather than `int` because a quantity is not always a count: `product.unit` allows
	 * `kg`, `liter`, `metre` and `hour`, so 0.75 kg of cheese is a legitimate line. The scale sets
	 * how finely those divide - two decimals, so 10 g is the smallest step a weighed product can
	 * be sold in. The precision is inherited from the money columns and is far wider than any
	 * quantity needs; nothing depends on it being 12.
	 *
	 * The transformer is what keeps the type honest: node-postgres hands a `numeric` over as a
	 * string, so without it the column arrives as `"1.00"` while the type here says `number` - and
	 * the pricing pass multiplies it by a unit price on every read.
	 */
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	quantity!: number;

	/**
	 * The `product_option` ids chosen, ascending. **Ids, not snapshots** - the price delta each
	 * one carries is looked up when the cart is priced, so an option repriced overnight is
	 * reflected the next time the shopper opens their cart.
	 */
	@Column('jsonb', {
		nullable: true,
		comment: 'Chosen product_option ids, ascending',
	})
	options!: number[] | null;

	/**
	 * Canonical form of `options`, for `UQ_cart_item_line`. Empty string when no option was
	 * chosen, never null - a null would let the same optionless line be inserted twice, since
	 * Postgres treats nulls in a unique index as distinct.
	 */
	@Column('varchar', {
		length: 64,
		nullable: false,
		default: '',
		comment: 'Hash of the ascending option ids, empty when there are none',
	})
	options_hash!: string;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('CartEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'cart_id' })
	cart!: CartEntity;

	// CASCADE: the component rows exist only to say what the header contains, so removing the
	// bundle from the cart takes them with it in one statement.
	@ManyToOne('CartItemEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'parent_id' })
	parent?: CartItemEntity | null;

	@OneToMany('CartItemEntity', (item: CartItemEntity) => item.parent)
	children?: CartItemEntity[];

	/*
	 * CASCADE, like the variant below and for the same reason: a cart is working state, not a
	 * record. A component withdrawn from the catalog takes the row with it, and the pricing pass
	 * then finds the line's composition no longer matching the live bundle and says so, rather
	 * than quoting a kit that is quietly one item short.
	 */
	@ManyToOne('ProductBundleItemEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'bundle_item_id' })
	bundle_item?: ProductBundleItemEntity | null;

	/**
	 * Composite over both columns at once, pointing at `product_variant (id, product_id)`, so a
	 * line cannot name a variant belonging to a different product.
	 */
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn([
		{ name: 'variant_id', referencedColumnName: 'id' },
		{ name: 'product_id', referencedColumnName: 'product_id' },
	])
	variant?: ProductVariantEntity;
}
