import type { DeepPartial, EntityManager } from 'typeorm';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import type { DocumentType } from '@/features/document-series/document-series.entity';
import DocumentSeriesEntity from '@/features/document-series/document-series.entity';
import {
	createDocumentSeriesQuery,
	getDocumentSeriesRepository,
} from '@/features/document-series/document-series.repository';
import {
	type DocumentSeriesValidator,
	paramsUpdateList,
} from '@/features/document-series/document-series.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * What a series hands out. Rendering the two into a reference a person reads (`INV-000142`)
 * is left to the display layer - the series holds no template to render it with.
 */
export type AllocatedReference = {
	code: string;
	number: number;
};

export class DocumentSeriesService {
	constructor(
		private repository: ReturnType<typeof getDocumentSeriesRepository>,
	) {}

	/**
	 * @description Hand out the next number of a document type's series.
	 *
	 * Takes the caller's `manager` so the counter moves in the same transaction as the document
	 * insert: a failed insert rolls the number back and the series stays gapless, which is the
	 * whole reason this is not a Postgres sequence. A concurrent allocation blocks on the row
	 * lock the UPDATE takes until that transaction ends.
	 *
	 * A committed number is never released. A canceled document keeps its number, and an issued
	 * invoice is taken back by a reversal that spends the next number of the same series - the
	 * tax authority expects one continuous numbering, so a number given back would be a gap in it.
	 *
	 * ```ts
	 * await dataSource.transaction(async (manager) => {
	 *   const ref = await documentSeriesService.allocate(
	 *     manager,
	 *     DocumentTypeEnum.INVOICE,
	 *   );
	 *
	 *   return manager.getRepository(InvoiceEntity).save({
	 *     ...entry,
	 *     ref_code: ref.code,
	 *     ref_number: ref.number,
	 *   });
	 * });
	 * ```
	 */
	public async allocate(
		manager: EntityManager,
		documentType: DocumentType,
	): Promise<AllocatedReference> {
		const series = await this.findSeries(manager, documentType);

		// A single statement rather than SELECT … FOR UPDATE + UPDATE: it takes the same row
		// lock, cannot read a value it then fails to claim, and stays one round trip.
		// Raw on purpose - a counter bump is not a business update and has no history entry.
		// TypeORM hands back `[rows, affectedCount]` for a write, not a bare row array
		const [rows]: [Array<{ number: number }>, number] = await manager.query(
			`UPDATE "document_series"
			 SET "next_number" = "next_number" + 1, "updated_at" = now()
			 WHERE "id" = $1
			 RETURNING "next_number" - 1 AS "number"`,
			[series.id],
		);

		const allocated = rows[0];

		if (!allocated) {
			// The row was deleted between the lookup and the update
			throw new BadRequestError(
				lang('document-series.error.not_allocatable', {
					document_type: series.document_type,
				}),
			);
		}

		const number = Number(allocated.number);

		return {
			code: series.code,
			number,
		};
	}

	private async findSeries(
		manager: EntityManager,
		documentType: DocumentType,
	): Promise<DocumentSeriesEntity> {
		const series = await createDocumentSeriesQuery(manager)
			.filterBy('document_type', documentType)
			.first();

		if (!series) {
			throw new BadRequestError(
				lang('document-series.error.not_configured', {
					document_type: documentType,
				}),
			);
		}

		return series;
	}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * One series per document type, enforced by a unique index. The lookup is what produces a
	 * message the caller can act on; the catch below covers the insert that loses a race with
	 * a concurrent one, where the index is the only thing left to stop it. Without either, a
	 * duplicate surfaces as a driver error - a 500 whose message the error handler masks.
	 */
	public async create(
		data: ValidatorOutput<DocumentSeriesValidator, 'create'>,
	): Promise<DocumentSeriesEntity> {
		const existing = await this.repository
			.createQuery()
			.filterBy('document_type', data.document_type)
			.first();

		if (existing) {
			throw this.alreadyExistsError(data.document_type);
		}

		try {
			return await this.repository.save({
				document_type: data.document_type,
				code: data.code,
				start_number: data.start_number,
				// A brand-new series has issued nothing, so the next number is the first one
				next_number: data.start_number,
				notes: data.notes ?? null,
			});
		} catch (error) {
			if (RepositoryAbstract.isUniqueViolation(error)) {
				throw this.alreadyExistsError(data.document_type);
			}

			throw error;
		}
	}

	private alreadyExistsError(documentType: DocumentType): CustomError {
		return new CustomError(
			409,
			lang('document-series.error.already_exists', {
				document_type: documentType,
			}),
		);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<DocumentSeriesEntity> & { id: number },
	): Promise<DocumentSeriesEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(DocumentSeriesEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: DocumentSeriesEntity,
		data: ValidatorOutput<DocumentSeriesValidator, 'update'>,
	): Promise<DocumentSeriesEntity> {
		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	/**
	 * Hard delete: the table has no `deleted_at`, and a series that has issued numbers should be
	 * left in place rather than removed - its counter is what the next allocation continues
	 * from.
	 */
	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete(false);
	}

	public findById(id: number): Promise<DocumentSeriesEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: number }) {
		return await this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.id)
			.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<DocumentSeriesValidator, 'find'>,
	) {
		return this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.filter.id)
			.filterBy('document_type', data.filter.document_type)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

const SELECT_COLUMNS = [
	'document_series.id',
	'document_series.document_type',
	'document_series.code',
	'document_series.start_number',
	'document_series.next_number',
	'document_series.notes',
	'document_series.created_at',
	'document_series.updated_at',
];

export const documentSeriesService = new DocumentSeriesService(
	getDocumentSeriesRepository(),
);
