import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_availability';

/**
 * Recurring windows in which the product may be ordered - a lunch menu on weekdays between 12:00
 * and 15:00, a happy hour every evening.
 *
 * Deliberately separate from `product.available_from` / `available_until`, which answer a
 * different question. Those are absolute and describe the product's life in the catalog: when it
 * first appears and when it is withdrawn, and they alone drive `sale_status`. These rows describe
 * the hours *within* that life when ordering is open, repeat forever, and leave `sale_status`
 * untouched - an out-of-hours product is still `available`, just not right now.
 *
 * A window is a weekday and, optionally, a span of clock times - no hours at all means the whole
 * of that day. Bounding the recurrence itself - a list that runs daily but only over the summer -
 * is the product's own life in the catalog, so it belongs on those absolute dates rather than
 * being expressed a second time here where it would not reach `sale_status`.
 *
 * **No row means always available.** The absence of a restriction is the common case and should
 * not require one row per weekday to express.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Recurring ordering windows for a product; no row at all means unrestricted',
})
// Resolving "can this be ordered now" reads every window for one product and filters by weekday
@Index('IDX_product_availability_product_id', ['product_id', 'day_of_week'])
// One interval per product per day. Created by hand in the init migration, since the
// `NULLS NOT DISTINCT` that also stops a second every-day (null) interval is beyond what `@Index`
// can state; declared here with `synchronize: false` so the generator neither drops nor rebuilds it.
@Index('IDX_product_availability_day_unique', { synchronize: false })
// ISO 8601 weekdays, the numbering `discount.conditions.day_range` is also written in - one
// reading of "day 1" across the codebase, resolved from a `Date` by `isoWeekday`
@Check(
	'CHK_product_availability_day_of_week',
	`(day_of_week IS NULL OR (day_of_week >= 1 AND day_of_week <= 7))`,
)
// Both or neither: a row with one time set has no reading anything could agree on
@Check(
	'CHK_product_availability_hours_paired',
	`(("starts_at" IS NULL) = ("ends_at" IS NULL))`,
)
@Check(
	'CHK_product_availability_hours_order',
	`("starts_at" IS NULL OR "ends_at" > "starts_at")`,
)
export default class ProductAvailabilityEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	product_id!: EntityId;

	/*
	 * ISO 8601 numbering, 1 = Monday … 7 = Sunday - the same one `discount.conditions.day_range`
	 * is written in, so a weekday means one thing everywhere it is stored or compared. It is not
	 * what `Date.getDay()` returns; `isoWeekday` in `helpers/date.helper` is the conversion, and
	 * is the only place that knows JavaScript counts from Sunday as 0.
	 */
	@Column('smallint', {
		nullable: true,
		comment:
			'Day this window applies to, ISO 8601 weekday, 1 = Monday; NULL means every day',
	})
	day_of_week!: number | null;

	/*
	 * `time` rather than `timestamp`: these are clock times that recur, with no date attached.
	 * They are read in the venue's timezone, not the customer's.
	 *
	 * **Null in both together means all day** - "available on Sundays" rather than the same rule
	 * spelled `00:00`–`23:59`. One set and one null is refused by a check constraint, because
	 * nothing could agree on what half a window means.
	 */
	@Column('time', {
		nullable: true,
		comment:
			'Window opens, venue local time; NULL together with ends_at means all day',
	})
	starts_at!: string | null;

	@Column('time', {
		nullable: true,
		comment:
			'Window closes, venue local time; NULL together with starts_at means all day',
	})
	ends_at!: string | null;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;
}
