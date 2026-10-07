import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

/**
 * The documents that carry a human-facing reference. One series per document type, which is what
 * an allocation resolves on.
 */
export const DocumentTypeEnum = {
	INVOICE: 'invoice',
	ORDER: 'order',
	GRN: 'grn',
	SUBSCRIPTION: 'subscription',
} as const;

export type DocumentType =
	(typeof DocumentTypeEnum)[keyof typeof DocumentTypeEnum];

const ENTITY_TABLE_NAME = 'document_series';

/**
 * Numbering series and their counters.
 *
 * A series stores only what has to be allocated - the code and the running number. How the two
 * are rendered into a reference is a presentation choice and belongs to whatever displays it,
 * so there is no template or padding column here.
 *
 * A series runs continuously - there is no yearly reset. Restarting the counter would need the
 * year on the document too: references are keyed on (`ref_code`, `ref_number`), so the first
 * document of a new year would collide with the first of the old one.
 *
 * **No `deleted_at`**, so this does not extend `EntityAbstract`. `RepositoryAbstract` soft-deletes
 * by default and every query filters `deleted_at IS NULL`, which for a counter means the row
 * holding the last issued number quietly disappears while its `document_type` stays taken - an
 * allocation would then fail rather than continue. Deleting a series is a hard delete, and only
 * safe before it has issued anything.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Document numbering series and their counters',
})
@Index('IDX_document_series_key', ['document_type'], {
	unique: true,
})
@Check(`("start_number" > 0 AND "next_number" > 0)`)
export default class DocumentSeriesEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column({
		type: 'enum',
		enum: DocumentTypeEnum,
		nullable: false,
	})
	document_type!: DocumentType;

	@Column('varchar', {
		length: 10,
		nullable: false,
		comment: 'Series prefix, e.g. INV',
	})
	code!: string;

	@Column('int', {
		nullable: false,
		default: 1,
		comment: 'First number of the series',
	})
	start_number!: number;

	@Column('int', {
		nullable: false,
		default: 1,
		comment: 'Number handed out by the next allocation',
	})
	next_number!: number;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;
}
