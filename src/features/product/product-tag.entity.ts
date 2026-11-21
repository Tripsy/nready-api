import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import ProductEntity from '@/features/product/product.entity';
import TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_tag';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Links products to tag terms',
})
@Index('IDX_product_tag_unique', ['product_id', 'tag_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
// Non-partial, for the reason `product-category.entity.ts` gives: `ProductTagRepository.syncLinks`
// reads by `product_id` with `withDeleted`, which no partial index answers
@Index('IDX_product_tag_product_id', ['product_id'])
// Carries `product_id` so the listing's tag filter answers from the index
@Index('IDX_product_tag_tag_id', ['tag_id', 'product_id'])
export default class ProductTagEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	product_id!: EntityId;

	@Column('uuid', { nullable: false })
	tag_id!: EntityId;

	// RELATIONS
	@ManyToOne(() => ProductEntity, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

	// CASCADE: a term is vocabulary, not a record worth protecting - removing it should take
	// its links with it rather than block the delete
	@ManyToOne(() => TermEntity, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'tag_id' })
	tag!: TermEntity;
}
