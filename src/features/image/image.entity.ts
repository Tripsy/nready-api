import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	OneToMany,
	UpdateDateColumn,
} from 'typeorm';
import type ImageContentEntity from '@/features/image/image-content.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';
import type { EntityId } from '@/shared/types/entity-id.type';

export const ImageSectionEnum = {
	PRODUCT: 'product',
	PRODUCT_VARIANT: 'product_variant',
	CATEGORY: 'category',
	BRAND: 'brand',
	ARTICLE: 'article',
} as const;

export type ImageSection =
	(typeof ImageSectionEnum)[keyof typeof ImageSectionEnum];

const IMAGE_SECTIONS: readonly string[] = Object.values(ImageSectionEnum);

/**
 * Whether this table stores anything for the named target at all.
 *
 * A predicate rather than a cast: a section reaches this feature as a plain table name - from the
 * target-image registry, and from `entityRemoved` - and the same check that decides to act is the
 * one that proves the type. Handing an unchecked string to a query would reach Postgres as an
 * invalid enum literal.
 */
export const isImageSection = (section: string): section is ImageSection =>
	IMAGE_SECTIONS.includes(section);

export const ImageTypeEnum = {
	LOGO: 'logo',
	GALLERY: 'gallery',
} as const;

export type ImageType = (typeof ImageTypeEnum)[keyof typeof ImageTypeEnum];

export const ImageStatusEnum = {
	ACTIVE: 'active',
	INACTIVE: 'inactive',
} as const;

export type ImageStatus =
	(typeof ImageStatusEnum)[keyof typeof ImageStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<ImageStatus> = {
	[ImageStatusEnum.ACTIVE]: [ImageStatusEnum.INACTIVE],
	[ImageStatusEnum.INACTIVE]: [ImageStatusEnum.ACTIVE],
};

export const ImageStorageEnum = {
	LOCAL: 'local',
	S3: 's3',
} as const;

export type ImageStorage =
	(typeof ImageStorageEnum)[keyof typeof ImageStorageEnum];

export const ImageMimeEnum = {
	JPEG: 'image/jpeg',
	PNG: 'image/png',
	GIF: 'image/gif',
	WEBP: 'image/webp',
	SVG: 'image/svg+xml',
} as const;

export type ImageMime = (typeof ImageMimeEnum)[keyof typeof ImageMimeEnum];

export type ImagePropertiesType = {
	width?: number; // pixel
	height?: number; // pixel
	size?: number; // in bytes
	mime?: ImageMime;
};

const ENTITY_TABLE_NAME = 'image';

@Entity({ name: ENTITY_TABLE_NAME, schema: 'public' })
@Index('IDX_image_type_id', ['entity_id', 'section', 'image_type'])
export default class ImageEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column({
		type: 'enum',
		enum: ImageSectionEnum,
		nullable: false,
		comment: 'The section this image belongs to',
	})
	section!: ImageSection;

	@Column('uuid', {
		nullable: false,
		comment: 'ID of the entity this image is linked to',
	})
	entity_id!: EntityId;

	@Column({
		type: 'enum',
		enum: ImageTypeEnum,
		nullable: false,
		comment: 'The type of the image',
	})
	image_type!: ImageType;

	@Column({
		type: 'enum',
		enum: ImageStorageEnum,
		default: ImageStorageEnum.LOCAL,
		nullable: false,
		comment: 'The storage destination of the image',
	})
	@Index('IDX_image_storage')
	storage!: ImageStorage;

	@Column('text', { nullable: false })
	path!: string;

	@Column('jsonb', {
		nullable: true,
		comment: 'Properties of the file',
	})
	properties!: ImagePropertiesType | null;

	@Column({
		type: 'enum',
		enum: ImageStatusEnum,
		default: ImageStatusEnum.ACTIVE,
		nullable: false,
	})
	status!: ImageStatus;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Order/position of the image within the entity type',
	})
	sort_order!: number;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@OneToMany(
		'ImageContentEntity',
		(content: ImageContentEntity) => content.image,
	)
	contents!: ImageContentEntity[];
}
