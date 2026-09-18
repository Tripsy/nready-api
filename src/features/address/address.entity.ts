import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type PlaceEntity from '@/features/place/place.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

/**
 * An address flattened into the columns a document freezes it as - the fields every holder of a
 * frozen address carries, and nothing else.
 *
 * Declared here rather than beside `client_address` because either kind of address flattens to it -
 * a client's, or the one behind a warehouse - and `address` is the feature both of those depend on,
 * so this is the only home that does not invert a dependency. `invoice.billing_details` and
 * `invoice.details` build on it for the same reason.
 *
 * The place names are text, not ids: a city renamed or removed later must not change what a
 * document already issued says.
 *
 * Every field is a required key holding a nullable value, not an optional key. A snapshot is
 * written whole, so a missing field and a field known to be empty are the same fact, and the
 * required key makes the compiler say which of the five the writer forgot.
 */
export type AddressSnapshotBase = {
	address_country: string | null;
	address_region: string | null;
	address_city: string | null;
	/** Street and number, then the holder's own flat/floor note when there is one. */
	details: string | null;
	postal_code: string | null;
};

/**
 * The base plus the free-text note the holder keeps against the address itself - delivery
 * instructions on a client address, a remark on a shipped row. A document that has its own `notes`
 * column does not use this variant.
 */
export type AddressSnapshot = AddressSnapshotBase & {
	notes: string | null;
};

/**
 * The base for a document that cannot be issued without naming a country - the invoice blocks,
 * where the country drives VAT treatment and has to be on the printed page.
 */
export type AddressSnapshotRequiredCountry = AddressSnapshotBase & {
	address_country: string;
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
