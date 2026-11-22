import { Column, Entity, Index } from 'typeorm';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const TemplateTypeEnum = {
	PAGE: 'page',
	EMAIL: 'email',
} as const;

export type TemplateType =
	(typeof TemplateTypeEnum)[keyof typeof TemplateTypeEnum];

export type PageContent = {
	title: string;
	html: string;
	vars?: TemplateVars;
	layout?: string;
};

type TemplateVarValue =
	| string
	| number
	| boolean
	| string[]
	| { [key: string]: TemplateVarValue }
	| TemplateVarValue[];

type TemplateVars = Record<string, TemplateVarValue>;

export type EmailContent = {
	subject: string;
	text?: string;
	html: string;
	vars?: TemplateVars;
	layout?: string;
};

/**
 * One row of `template.seed.ts`. Exported from the entity rather than from the seed, because the
 * seed self-executes on import - a feature contributing its own templates has to be able to name
 * the shape without starting a seeding run.
 */
export type TemplateSeedEntry = {
	label: string;
	language: string;
	type: TemplateType;
	content: EmailContent | PageContent;
};

export type EmailTemplate = {
	id?: EntityId;
	language: string;
	content: EmailContent;
};

const ENTITY_TABLE_NAME = 'template';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'system',
	comment: 'Stores email & page templates',
})
@Index('IDX_label_language_type', ['label', 'language', 'type'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class TemplateEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', { nullable: false })
	label!: string;

	@Column('varchar', {
		length: 3,
	})
	language!: string;

	@Column({
		type: 'enum',
		enum: TemplateTypeEnum,
		default: TemplateTypeEnum.PAGE,
		nullable: false,
	})
	type!: TemplateType;

	@Column({ type: 'jsonb', nullable: false, comment: 'Template data' })
	content!: Record<string, unknown>;
}
