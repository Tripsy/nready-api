import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type PlaceContentEntity from '@/features/place/place-content.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

export const PlaceTypeEnum = {
	COUNTRY: 'country',
	REGION: 'region',
	CITY: 'city',
} as const;

export type PlaceType = (typeof PlaceTypeEnum)[keyof typeof PlaceTypeEnum];

const ENTITY_TABLE_NAME = 'place';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Places (countries, regions, cities)',
})
export default class PlaceEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('enum', {
		enum: PlaceTypeEnum,
		default: PlaceTypeEnum.COUNTRY,
		nullable: false,
	})
	place_type!: PlaceType;

	@Column('int', { nullable: true })
	@Index('IDX_place_parent_id')
	parent_id!: number | null; // country -> null, region -> country_id, city -> region_id or country_id

	@Column('varchar', { length: 3, nullable: true, comment: 'Abbreviation' })
	@Index('IDX_place_code')
	code!: string | null;

	/**
	 * ISO 3166-1 alpha-2, on a country and nowhere else - a region or a city has no country code
	 * of its own.
	 *
	 * Separate from `code`, which is the place seed's natural key and links a child to its parent;
	 * rewriting that to two letters would change the key rows are matched on. This is the
	 * vocabulary country *rules* are written in - `discount.conditions.applicable_countries`, and
	 * `article_visibility_rule.allowed_countries`, which is compared against CDN geo headers that
	 * emit alpha-2 and are not ours to change.
	 *
	 * Null on a country nobody has filled in yet, which fails every country condition closed.
	 */
	@Column('varchar', {
		length: 2,
		nullable: true,
		comment:
			'ISO 3166-1 alpha-2, countries only; the vocabulary country rules are matched against',
	})
	alpha2_code!: string | null;

	// RELATIONS
	@ManyToOne(
		() => PlaceEntity,
		(place) => place.children,
		{ onDelete: 'SET NULL' },
	)
	@JoinColumn({ name: 'parent_id' })
	parent?: PlaceEntity;

	@OneToMany(
		() => PlaceEntity,
		(place) => place.parent,
	)
	children!: PlaceEntity[];

	@OneToMany(
		'PlaceContentEntity',
		(content: PlaceContentEntity) => content.place,
	)
	contents!: PlaceContentEntity[];
}
