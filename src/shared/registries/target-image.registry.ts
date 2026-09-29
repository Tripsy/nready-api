/**
 * The image a feature shows for one of its own rows, looked up without importing the feature that
 * stores images.
 *
 * `image` writes against `(section, entity_id)` with no foreign key to anything, so a target has
 * no relation to walk and would otherwise have to reach into the image repository to find its own
 * picture - which is what `article` did, and what made optional decoration a hard install-time
 * dependency. A project should be able to take `article`, `brand` or `category` and leave the
 * image library behind.
 *
 * **One provider, not one per section.** Participation keys its map by target because each target
 * owns its own switch. Every section's images live in one table owned by one feature, so a second
 * slot would invent a plurality that does not exist.
 *
 * The vocabulary here is deliberately the *storing* feature's - an image and its type - not the
 * role a page casts it in. What an article calls its `cover_image` is article's word for the first
 * gallery image; a brand asking the same registry for its `logo` is not asking for a cover.
 */

/**
 * What an image is for. A target asks for the kind it wants: a brand shows its `logo`, an article
 * the first of its `gallery`.
 *
 * Declared here rather than imported from the image feature even though it duplicates
 * `ImageTypeEnum` - that import is the dependency this file exists to remove. The duplication is
 * the tripwire: a provider whose own enum grows past this one stops compiling in its bootstrap,
 * which is where somebody should notice that consumers gained an option.
 */
export const TargetImageTypeEnum = {
	LOGO: 'logo',
	GALLERY: 'gallery',
} as const;

export type TargetImageType =
	(typeof TargetImageTypeEnum)[keyof typeof TargetImageTypeEnum];

/**
 * How the file is reached - the vocabulary the API promises its clients, owned here for the same
 * reason as the type above, and mirroring `ImageStorageEnum`.
 */
export const TargetImageStorageEnum = {
	LOCAL: 'local',
	S3: 's3',
} as const;

export type TargetImageStorage =
	(typeof TargetImageStorageEnum)[keyof typeof TargetImageStorageEnum];

/**
 * Whatever the provider knows about the file; an older row may know none of it. `mime` stays a
 * plain string - no consumer branches on it, so restating the five literals buys nothing.
 */
export type TargetImageProperties = {
	width?: number;
	height?: number;
	size?: number;
	mime?: string;
};

export type TargetImage = {
	id: number;
	path: string;
	storage: TargetImageStorage;
	properties: TargetImageProperties | null;
};

/**
 * Answers for a whole page at once, keyed by entity id; an id with no image of that type is simply
 * absent from the map. Batched because a listing must not turn into one query per card.
 *
 * `section` is the target's table name (`ArticleEntity.NAME`), the way a polymorphic target is
 * named everywhere here. A provider that does not serve that section answers with an empty map
 * rather than failing - an unknown section is a deployment fact, not an error.
 *
 * Which of several images wins is the provider's rule, not the caller's: it returns the first by
 * whatever order it keeps them in.
 */
export type TargetImageProvider = (
	section: string,
	imageType: TargetImageType,
	entityIds: number[],
) => Promise<Map<number, TargetImage>>;

/**
 * The same question asked of a whole gallery: every image a target carries of that type, in the
 * order it shows them.
 *
 * A second slot rather than a second answer on the first, because the two are different questions
 * and a caller almost always wants exactly one of them. A listing wants the one picture that
 * stands for each row and must not drag twelve down the wire per card; a detail page wants the
 * set. Folding them together would make the cheap call pay for the expensive one.
 *
 * Registered from the same bootstrap and by the same feature - this is still one provider of
 * images, asked two ways.
 */
export type TargetImageListProvider = (
	section: string,
	imageType: TargetImageType,
	entityIds: number[],
) => Promise<Map<number, TargetImage[]>>;

let targetImageProvider: TargetImageProvider | null = null;
let targetImageListProvider: TargetImageListProvider | null = null;

/**
 * Called from the providing feature's `*.bootstrap.ts`. Registering twice replaces the previous
 * provider rather than adding a second opinion - a reload, not a second source of images.
 */
export const registerTargetImageProvider = (
	provider: TargetImageProvider,
): void => {
	targetImageProvider = provider;
};

export const resolveTargetImages = async (
	section: string,
	imageType: TargetImageType,
	entityIds: number[],
): Promise<Map<number, TargetImage>> => {
	if (!targetImageProvider || entityIds.length === 0) {
		return new Map();
	}

	return targetImageProvider(section, imageType, entityIds);
};

/** Called from the providing feature's `*.bootstrap.ts`, like the primary one above. */
export const registerTargetImageListProvider = (
	provider: TargetImageListProvider,
): void => {
	targetImageListProvider = provider;
};

/**
 * Every image each named target carries, keyed by entity id; a target with none is absent from
 * the map rather than present with an empty list, so the two slots read alike.
 *
 * With nothing registered this answers an empty map - the same "no image feature installed" state
 * `resolveTargetImages` describes, and a consumer renders it as an empty gallery either way.
 */
export const resolveTargetImageLists = async (
	section: string,
	imageType: TargetImageType,
	entityIds: number[],
): Promise<Map<number, TargetImage[]>> => {
	if (!targetImageListProvider || entityIds.length === 0) {
		return new Map();
	}

	return targetImageListProvider(section, imageType, entityIds);
};
