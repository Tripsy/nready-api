import { isImageSection } from '@/features/image/image.entity';
import { imageService } from '@/features/image/image.service';
import {
	registerTargetImageListProvider,
	registerTargetImageProvider,
	type TargetImageType,
} from '@/shared/registries/target-image.registry';

/**
 * Registers where the image standing for a row comes from, so a feature rendering a page can show
 * one without knowing that images live in a table at all - and so a deployment without this
 * feature simply shows none.
 *
 * The direction is inverted against `article.bootstrap.ts`: there the target registers an answer
 * about its own rows for other features to read; here this feature registers a lookup others
 * consume. Same rule underneath - the feature that owns the data owns the code, and the registry
 * is what the two sides share instead of an import.
 *
 * A section this table does not carry answers empty rather than failing: `section` arrives as a
 * plain table name, and a consumer asking for one nobody files images against is a deployment
 * fact, not an error.
 *
 * `TargetImageType` and `ImageType` are separate declarations of the same two values - the
 * duplication that keeps the registry importable without this feature. They meet here, and here
 * is where a divergence would stop compiling.
 */
export default function registerImageBootstrap() {
	registerTargetImageProvider(
		async (
			section: string,
			imageType: TargetImageType,
			entityIds: number[],
		) => {
			if (!isImageSection(section)) {
				return new Map();
			}

			return imageService.getPrimaryByTargets(
				section,
				imageType,
				entityIds,
			);
		},
	);

	// The same images asked for as whole galleries - what a detail page shows, where a listing
	// wants only the one picture that stands for each row. Same feature, same table, two
	// questions; see `TargetImageListProvider`.
	registerTargetImageListProvider(
		async (
			section: string,
			imageType: TargetImageType,
			entityIds: number[],
		) => {
			if (!isImageSection(section)) {
				return new Map();
			}

			return imageService.getGalleryByTargets(
				section,
				imageType,
				entityIds,
			);
		},
	);
}
