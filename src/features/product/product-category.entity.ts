import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type CategoryEntity from '@/features/category/category.entity';
import type ProductEntity from '@/features/product/product.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_category';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Links products to categories (multilingual via term)',
})
@Index('IDX_product_category_unique', ['product_id', 'category_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
/*
 * The unique index above cannot stand in for this one: it is partial, and
 * `ProductCategoryRepository.syncLinks` reads by `product_id` with `withDeleted` so it can revive
 * a link rather than insert a second one that collides. The foreign key's cascade looks the
 * children up the same way.
 */
@Index('IDX_product_category_product_id', ['product_id'])
// Carries `product_id` so the listing's category filter - which seeks the link by `category_id`
// and needs the product back - answers from the index instead of the heap
@Index('IDX_product_category_category_id', ['category_id', 'product_id'])
export default class ProductCategoryEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	product_id!: EntityId;

	@Column('uuid', { nullable: false })
	category_id!: EntityId;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

	@ManyToOne('CategoryEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'category_id' })
	category!: CategoryEntity;
}
