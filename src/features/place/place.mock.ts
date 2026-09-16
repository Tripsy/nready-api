import type PlaceEntity from '@/features/place/place.entity';
import { PlaceTypeEnum } from '@/features/place/place.entity';
import { OrderByEnum, PlaceValidator } from '@/features/place/place.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const placeValidator = new PlaceValidator('place');

export function getPlaceEntityMock(): PlaceEntity {
	return {
		id: 1,
		place_type: PlaceTypeEnum.COUNTRY,
		parent_id: null,
		// `code` is the alpha-3 natural key; `alpha2_code` is what country rules match against
		code: 'ROU',
		alpha2_code: 'RO',
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		children: [],
		contents: [],
	};
}

export const placeInputPayloads = {
	create: {
		place_type: PlaceTypeEnum.COUNTRY,
		code: 'ROU',
		alpha2_code: 'RO',
		parent_id: undefined,
		contents: [
			{
				language: 'en',
				name: 'Romania',
				type_label: 'Country',
			},
		],
	},
	update: {
		id: 1,
		place_type: PlaceTypeEnum.COUNTRY,
		code: 'ROU',
		alpha2_code: 'RO',
		parent_id: undefined,
		contents: [
			{
				language: 'en',
				name: 'Romania',
				type_label: 'Country',
			},
		],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'roma',
			place_type: PlaceTypeEnum.COUNTRY,
			language: 'en',
			is_deleted: false,
		},
	},
};

export const placeOutputPayloads = {
	create: placeValidator.create.parse(placeInputPayloads.create),
	update: placeValidator.update.parse(placeInputPayloads.update),
	find: placeValidator.find.parse(placeInputPayloads.find),
};
