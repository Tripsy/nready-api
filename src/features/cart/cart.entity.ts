import {
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
import type CartItemEntity from '@/features/cart/cart-item.entity';
import type UserEntity from '@/features/user/user.entity';

/**
 * How long an untouched cart is kept. Slid forward on every write, so this measures silence
 * rather than age - a shopper who adds something on day 29 keeps the cart for another 30 days.
 */
export const CART_TTL_SECONDS = 30 * 24 * 60 * 60;

const ENTITY_TABLE_NAME = 'cart';

/**
 * What a shopper has picked out but not yet bought: no identity, no document number, and today's
 * price on every read - the row holds references only. It becomes an order at
 * `CartService.toOrder`, which is where a billing counterparty, a `document_series` number and
 * frozen price/VAT figures are first attached. The rate those figures convert at is the document's
 * too, resolved by `OrderService` as the order is raised - a basket holds none.
 *
 * A cart has no lifecycle of its own. It exists while somebody is filling it and is deleted the
 * moment it stops being that - checked out, folded into an account's own at sign-in, or left
 * untouched past `expires_at`. There is nothing to keep afterward: the order is the record of
 * what was bought, and a basket nobody came back to is not a document.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores shopping carts, for guests and members alike',
})
// One cart per member, full stop. A member's cart is deleted when it checks out, so the slot is
// free again immediately and the same account can start another.
@Index('UQ_cart_user', ['user_id'], {
	unique: true,
	where: 'user_id IS NOT NULL',
})
// The cleanup cron's whole query.
@Index('IDX_cart_expires_at', ['expires_at'])
export default class CartEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	/**
	 * The guest's identity: an opaque handle the client keeps and sends back in `X-Cart-Token`,
	 * and the only way an unauthenticated caller can name their own cart.
	 *
	 * Returned in the response body rather than set as a cookie, matching how this API already
	 * hands out its access token - the caller decides where to keep it, and nothing depends on
	 * cross-site cookie behavior between the API and a frontend on another host.
	 *
	 * A random uuid rather than the `user_ip_hash` that `comment` and `rating` use. That column is
	 * abuse control on a low-value row, and it is wrong for this job in both directions - one
	 * address is shared by everyone behind a NAT, and a shopper's address changes between the
	 * train and the sofa while the cart is supposed to survive both.
	 *
	 * It stays set after a merge that claimed the cart outright, so a member browsing in a second,
	 * signed-out tab still resolves to a cart rather than silently starting another one.
	 */
	@Column('uuid', {
		nullable: false,
		comment: 'Opaque handle held by the client, guest identity',
	})
	@Index('UQ_cart_token', { unique: true })
	token!: string;

	/**
	 * Set when the shopper is signed in, either because the cart was created that way or because
	 * `CartService.merge` claimed a guest cart at login. Null on every cart still anonymous.
	 */
	@Column('int', {
		nullable: true,
	})
	user_id!: number | null;

	/**
	 * The market the cart is priced in, and the currency every `product_price` lookup is made
	 * against. Stored rather than re-read per request so a shopper who switches market gets an
	 * explicit reprice instead of a total that changes under them mid-session.
	 */
	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
		comment: 'Market the cart is priced in',
	})
	currency!: string;

	/**
	 * When the cleanup cron may delete the cart. Slid forward on every write, so a cart being
	 * worked on never expires and one left alone does.
	 */
	@Column('timestamp', {
		nullable: false,
	})
	expires_at!: Date;

	// RELATIONS

	// CASCADE: a cart is the account's own working state, not a record anybody has to keep, so a
	// closed account takes its cart - and through it its items - with it.
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity | null;

	@OneToMany('CartItemEntity', (item: CartItemEntity) => item.cart)
	items?: CartItemEntity[];
}
