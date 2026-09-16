import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type PlaceEntity from '@/features/place/place.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

/**
 * An address flattened into the columns a document freezes it as, sharing its field names with
 * `invoice.billing_details`.
 *
 * Declared here rather than beside `client_address` because either kind of address flattens to it -
 * a client's, or the one behind a warehouse - and `address` is the feature both of those depend on,
 * so this is the only home that does not invert a dependency.
 *
 * The place names are text, not ids: a city renamed or removed later must not change what a
 * document already issued says.
 */
export type AddressSnapshot = {
	address_country: string | null;
	address_region: string | null;
	address_city: string | null;
	/** Street and number, then the holder's own flat/floor note when there is one. */
	details: string | null;
	postal_code: string | null;
	notes: string | null;
};

const ENTITY_TABLE_NAME = 'address';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Addresses',
})
export default class AddressEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: true })
	@Index('IDX_address_city_id')
	city_id!: number | null;

	@Column('text')
	details!: string;

	@Column('varchar', { nullable: true })
	postal_code!: string | null;

	// RELATIONS
	@ManyToOne('PlaceEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'city_id' })
	city?: PlaceEntity | null;
}
