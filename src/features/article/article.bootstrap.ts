import type { ArticleSetting } from '@/features/article/article.entity';
import ArticleEntity, {
	ArticleSettingEnum,
} from '@/features/article/article.entity';
import { articleService } from '@/features/article/article.service';
import {
	type Participation,
	ParticipationEnum,
	registerParticipationResolver,
} from '@/shared/registries/target-participation.registry';

const SETTING_BY_PARTICIPATION: Record<Participation, ArticleSetting> = {
	[ParticipationEnum.RATING]: ArticleSettingEnum.ALLOW_RATING,
	[ParticipationEnum.COMMENT]: ArticleSettingEnum.ALLOW_COMMENTS,
	[ParticipationEnum.COMPLAINT]: ArticleSettingEnum.ALLOW_COMPLAINTS,
};

/**
 * Registers what an article accepts from its readers, so `comment`, `rating` and `complaint` can
 * refuse a write without knowing that this target is an article or where its switches are kept.
 *
 * An article that cannot be found answers `false` for everything: the resolver is asked only on
 * the way into a public write, and a soft-deleted article has no page to write to.
 */
export default function registerArticleBootstrap() {
	registerParticipationResolver(
		ArticleEntity.NAME,
		async (entityId: number, participation: Participation) => {
			const settings = await articleService.getSettings(entityId);

			return settings
				? settings[SETTING_BY_PARTICIPATION[participation]]
				: false;
		},
	);
}
