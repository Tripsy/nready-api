/**
 * Whether a polymorphic target still accepts what a reader is about to add to it.
 *
 * `comment`, `rating` and `complaint` all write against `(entity_type, entity_id)` and know
 * nothing about the tables behind those ids - deliberately, so a new target costs them nothing.
 * The switch that closes one of them, though, belongs to the target: an article carries
 * `allow_rating` / `allow_comments` / `allow_complaints`, and only the `article` feature knows
 * where they are stored or what they default to.
 *
 * So the dependency runs the same way as the `entityRemoved` listeners: the feature owning the
 * target registers a resolver for its own rows, and the feature doing the writing asks the
 * registry rather than the feature. Nothing here imports a feature, and no feature imports
 * another.
 *
 * **A target with no resolver is open.** `article` is the only one that registers today - a rating
 * on a comment resolves open, and so would any target added later - and that is what keeps this
 * additive: registering nothing changes nothing.
 *
 * Resolvers are registered from `*.bootstrap.ts` files, which `bootstrap.setup.ts` runs before
 * the server listens. That step is skipped in the `test` environment, so the registry is empty
 * there and every target reads as open; a test covering a closed one registers its own resolver.
 */

export const ParticipationEnum = {
	RATING: 'rating',
	COMMENT: 'comment',
	COMPLAINT: 'complaint',
} as const;

export type Participation =
	(typeof ParticipationEnum)[keyof typeof ParticipationEnum];

/**
 * Answers for one target row. `false` closes that kind of participation; a target that cannot be
 * resolved at all - deleted, or never there - is expected to answer `false` for everything,
 * since nothing may be attached to a page no reader can open.
 */
export type ParticipationResolver = (
	entityId: number,
	participation: Participation,
) => Promise<boolean>;

const resolvers = new Map<string, ParticipationResolver>();

/**
 * Called by the owning feature's listener at bootstrap. Registering twice for the same entity
 * type replaces the previous resolver rather than adding a second opinion - there is one owner
 * per table, and a duplicate registration is a reload, not a second rule.
 */
export const registerParticipationResolver = (
	entityType: string,
	resolver: ParticipationResolver,
): void => {
	resolvers.set(entityType, resolver);
};

export const isParticipationAllowed = async (
	entityType: string,
	entityId: number,
	participation: Participation,
): Promise<boolean> => {
	const resolver = resolvers.get(entityType);

	if (!resolver) {
		return true;
	}

	return resolver(entityId, participation);
};
