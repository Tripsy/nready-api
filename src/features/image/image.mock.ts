import type ImageEntity from '@/features/image/image.entity';
import {
	ImageMimeEnum,
	ImageSectionEnum,
	ImageStatusEnum,
	ImageStorageEnum,
	ImageTypeEnum,
} from '@/features/image/image.entity';
import { ImageValidator, OrderByEnum } from '@/features/image/image.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const imageValidator = new ImageValidator('image');

export function getImageEntityMock(): ImageEntity {
	return {
		id: mockId(1),
		section: ImageSectionEnum.PRODUCT,
		entity_id: mockId(1),
		image_type: ImageTypeEnum.GALLERY,
		storage: ImageStorageEnum.LOCAL,
		path: '/products/pepsi.jpg',
		properties: {
			width: 240,
			height: 240,
			size: 1048576,
			mime: ImageMimeEnum.JPEG,
		},
		status: ImageStatusEnum.ACTIVE,
		sort_order: 0,
		details: null,
		created_at: createPastDate(86400),
		updated_at: null,
		contents: [],
	};
}

export const imageInputPayloads = {
	create: {
		section: ImageSectionEnum.PRODUCT,
		entity_id: mockId(1),
		image_type: ImageTypeEnum.GALLERY,
		storage: ImageStorageEnum.LOCAL,
		path: '/products/pepsi.jpg',
		properties: {
			width: 240,
			height: 240,
			size: 1048576,
			mime: ImageMimeEnum.JPEG,
		},
		sort_order: 1,
		contents: [
			{
				language: 'en',
				title: 'Pepsi Commercial',
				description: 'Pepsi Commercial',
			},
		],
	},
	update: {
		id: mockId(1),
		section: ImageSectionEnum.PRODUCT,
		entity_id: mockId(1),
		image_type: ImageTypeEnum.GALLERY,
		storage: ImageStorageEnum.LOCAL,
		path: '/products/pepsi.jpg',
		properties: {
			width: 240,
			height: 240,
			size: 1048576,
			mime: ImageMimeEnum.JPEG,
		},
		contents: [
			{
				language: 'en',
				title: 'Pepsi Commercial',
				description: 'Pepsi Commercial',
			},
		],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			section: ImageSectionEnum.PRODUCT,
			image_type: ImageTypeEnum.GALLERY,
			status: ImageStatusEnum.ACTIVE,
			language: 'en',
		},
	},
	orderUpdate: {
		section: ImageSectionEnum.PRODUCT,
		entity_id: mockId(1),
		positions: [
			{ id: mockId(1), sort_order: 1 },
			{ id: mockId(2), sort_order: 2 },
		],
	},
};

export const imageOutputPayloads = {
	create: imageValidator.create.parse(imageInputPayloads.create),
	update: imageValidator.update.parse(imageInputPayloads.update),
	find: imageValidator.find.parse(imageInputPayloads.find),
	orderUpdate: imageValidator.orderUpdate.parse(
		imageInputPayloads.orderUpdate,
	),
};
