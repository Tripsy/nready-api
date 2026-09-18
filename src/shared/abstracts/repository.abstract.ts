import {
	Brackets,
	type EntityTarget,
	type ObjectLiteral,
	QueryFailedError,
	type Repository,
	type SelectQueryBuilder,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError, NotFoundError } from '@/exceptions';
import {
	type OrderDirection,
	OrderDirectionEnum,
} from '@/shared/abstracts/entity.abstract';
import {
	cleanEntityCacheMany,
	type EntityWithCache,
} from '@/shared/abstracts/service.abstract';

// `boolean` is here for flag columns (`is_default`, `is_active`): the driver binds it natively,
// so a filter on one needs no string that Postgres has to cast back
type QueryValue = string | number | boolean | (string | number)[] | null;
type QueryParams = Record<string, QueryValue>;

type FilterByPropsType = {
	column: string;
	value?: QueryValue;
	operator: string;
};

abstract class RepositoryAbstract<TEntity extends ObjectLiteral> {
	private repository: Repository<TEntity>;
	protected entity: string;
	protected query: SelectQueryBuilder<TEntity>;
	protected hasFilter: boolean = false; // Flag used to signal if query builder filters have been applied in preparation for delete operations
	protected hasGroup: boolean = false; // Flag used to signal if query builder groups have been applied

	protected constructor(repository: Repository<TEntity>, entity: string) {
		this.repository = repository;
		this.entity = entity;
		this.query = repository.createQueryBuilder(this.entity);
	}

	debugSql(): string {
		return this.query.getSql();
	}

	debugParameters(): ObjectLiteral {
		return this.query.getParameters();
	}

	debug(): this {
		console.debug('SQL:', this.query.getSql());
		console.debug('Parameters:', this.query.getParameters());

		return this;
	}

	join(
		entityOrProperty: string,
		alias: string,
		type: 'INNER' | 'LEFT' = 'INNER',
		condition?: string,
		parameters?: ObjectLiteral,
	): this {
		switch (type) {
			case 'INNER':
				this.query.innerJoin(
					entityOrProperty,
					alias,
					condition,
					parameters,
				);
				break;
			case 'LEFT':
				this.query.leftJoin(
					entityOrProperty,
					alias,
					condition,
					parameters,
				);
				break;
		}

		return this;
	}

	/**
	 * Note: This method automatically selects all related fields (including relations)
	 */
	joinAndSelect(
		entityOrProperty: string,
		alias: string,
		type: 'INNER' | 'LEFT' = 'INNER',
		condition?: string,
		parameters?: ObjectLiteral,
	): this {
		switch (type) {
			case 'INNER':
				this.query.innerJoinAndSelect(
					entityOrProperty,
					alias,
					condition,
					parameters,
				);
				break;
			case 'LEFT':
				this.query.leftJoinAndSelect(
					entityOrProperty,
					alias,
					condition,
					parameters,
				);
				break;
		}

		return this;
	}

	/**
	 * Note: Without primaryKey TypeORM won’t map the entity correctly.
	 *
	 * ex: ['user.id', 'user.name', 'user.email', 'user.status', 'user.created_at', 'user.updated_at']
	 * ex: ['id', 'name', 'email', 'status', 'created_at', 'updated_at']
	 */
	select(fields: string[], autoAppendId: boolean = true): this {
		if (autoAppendId) {
			// Define possible primary key variations
			const primaryKeys = [`${this.entity}.id`, 'id'];

			// Check if either 'id' or 'user.id' is already included
			const hasPrimaryKey = fields.some((field) =>
				primaryKeys.includes(field),
			);

			// If not present, add the fully qualified primary key
			if (!hasPrimaryKey) {
				fields.unshift(`${this.entity}.id`);
			}
		}

		this.query.select(this.prefixFields(fields));

		return this;
	}

	addSelect(fields: string[]) {
		this.query.addSelect(this.prefixFields(fields));

		return this;
	}

	/**
	 * Ensure all fields are prefixed with an entity alias if not add this.entity
	 *
	 * @param fields
	 * @private
	 */
	private prefixFields(fields: string[]) {
		return fields.map((field) =>
			field.includes('.') ? field : `${this.entity}.${field}`,
		);
	}

	private isValidColumn(column: string): boolean {
		// Allow only letters, numbers, underscores dots and cast characters (:)
		const columnPattern = /^[a-zA-Z0-9_.:]+$/;

		return columnPattern.test(column);
	}

	private prepareColumn(column: string): string {
		// Validate or sanitize the column name
		if (!this.isValidColumn(column)) {
			throw new Error(`Invalid column name: ${column}`);
		}

		return column.includes('.') ? column : `${this.entity}.${column}`;
	}

	private safeColumnKey(column: string): string {
		return (
			column
				// Replace all non-alphanumeric characters (except underscore) with _
				.replace(/[^a-zA-Z0-9_]/g, '_')
				// Remove leading/trailing underscores
				.replace(/^_+|_+$/g, '')
				// Ensure it doesn't start with a number
				.replace(/^(\d)/, 'param_$1')
		);
	}

	private buildWhereCondition(
		column: string,
		columnKey: string,
		operator: string,
	): string {
		switch (operator) {
			case 'IN':
				return `${this.prepareColumn(column)} IN (:...${columnKey})`;
			default:
				return `${this.prepareColumn(column)} ${operator} :${columnKey}`;
		}
	}

	/**
	 * Return the ` SelectQueryBuilder ` object so further TypeOrm methods can be chained
	 */
	getQuery(): SelectQueryBuilder<TEntity> {
		return this.query;
	}

	setParameter(key: string, value: QueryValue): this {
		this.query.setParameter(key, value);

		return this;
	}

	withDeleted(condition: boolean = true) {
		if (condition) {
			this.query.withDeleted();
		}

		return this;
	}

	/**
	 * Note: When using getOne(), TypeORM expects only entity fields to be selected.
	 *       If you manually select raw SQL fields (e.g., COUNT(user.id) as count), getOne() will return null.
	 */
	first() {
		return this.query.getOne();
	}

	firstRaw() {
		return this.query.getRawOne();
	}

	async firstOrFail(isRaw: boolean = false) {
		const result = isRaw ? await this.firstRaw() : await this.first();

		if (!result) {
			throw new NotFoundError(
				lang(
					`${this.entity}.error.not_found`,
					{},
					'Record(s) not found',
				),
			);
		}

		return result;
	}

	orderBy(
		column?: string,
		direction: OrderDirection = OrderDirectionEnum.ASC,
	): this {
		if (column) {
			this.query.addOrderBy(`${this.prepareColumn(column)}`, direction);
		}

		return this;
	}

	groupBy(column: string): this {
		if (column) {
			this.hasGroup = true;

			this.query.addGroupBy(`${this.prepareColumn(column)}`);
		}

		return this;
	}

	pagination(page: number = 1, limit: number = 10): this {
		this.query.skip((page - 1) * limit).take(limit);

		return this;
	}

	all(): Promise<TEntity[]>;
	all(withCount: false): Promise<TEntity[]>;
	all(withCount: true): Promise<[TEntity[], number]>;
	all(
		withCount: boolean = false,
	): Promise<TEntity[]> | Promise<[TEntity[], number]> {
		if (withCount) {
			if (this.hasGroup) {
				throw new CustomError(
					500,
					lang('shared.error.db_select_count_while_using_groups'),
				);
			}

			return this.query.getManyAndCount();
		}

		return this.query.getMany();
	}

	count() {
		return this.query.getCount();
	}

	/**
	 * Used to (soft) delete a single entity or multiple entities
	 * Events will be triggered (ex: beforeRemove for delete, afterSoftRemove for soft delete)
	 *
	 * @param isSoftDelete - if set as `true` will be soft deleted
	 * @param multiple - must be set as `true` to allow multiple entity deletion
	 * @param force - if set as `true` will allow deletion without any proper filter (note: Use with caution!!!)
	 */
	async delete(
		isSoftDelete: boolean = true,
		multiple: boolean = false,
		force: boolean = false,
	): Promise<number> {
		if (!force && !this.hasFilter) {
			throw new CustomError(
				500,
				lang('shared.error.db_delete_missing_filter'),
			);
		}

		const ids = await dataSource.transaction(async (manager) => {
			const results = await this.query.getMany();

			if (results.length === 0) {
				throw new NotFoundError(
					lang(
						`${this.entity}.error.not_found`,
						{},
						'Record(s) not found',
					),
				);
			}

			if (!multiple && results.length > 1) {
				throw new CustomError(500, lang('shared.error.db_delete_one'));
			}

			const repo = manager.getRepository<TEntity>(this.repository.target);

			if (isSoftDelete) {
				await Promise.all(
					results.map((entity) => repo.softRemove(entity)),
				);
			} else {
				await Promise.all(results.map((entity) => repo.remove(entity)));
			}

			// Every row the filter reached, not the filter itself: a delete narrowed by
			// `user_id` affects rows whose ids it never named.
			return results.map((entity) => entity.id);
		});

		await this.cleanCache(ids);

		return ids.length;
	}

	async restore(
		multiple: boolean = false,
		force: boolean = false,
	): Promise<number> {
		if (!force && !this.hasFilter) {
			throw new CustomError(
				500,
				lang('shared.error.db_restore_missing_filter'),
			);
		}

		const ids = await dataSource.transaction(async (manager) => {
			const results = await this.query.withDeleted().getMany();

			if (results.length === 0) {
				throw new NotFoundError(
					lang(
						`${this.entity}.error.not_found`,
						{},
						'Record(s) not found',
					),
				);
			}

			if (!multiple && results.length > 1) {
				throw new CustomError(500, lang('shared.error.db_restore_one'));
			}

			for (const entity of results) {
				(entity as ObjectLiteral).deleted_at = null;
			}

			const repo = manager.getRepository<TEntity>(this.repository.target);
			await repo.save(results);

			return results.map((entity) => entity.id);
		});

		await this.cleanCache(ids);

		return ids.length;
	}

	/**
	 * Drops the cached entries of the rows a terminal just wrote, **after** its transaction has
	 * committed - inside it, a concurrent reader could refill the cache from a snapshot the commit
	 * is about to supersede, and nothing further would come along to correct it.
	 *
	 * The entity class is reached through `this.repository.target`, which TypeORM types as
	 * `EntityTarget<T>` - legitimately a string or a schema, not only a class - so the statics have
	 * to be read defensively. Failing closed is right: something without them owns no keyspace.
	 */
	private async cleanCache(ids: number[]): Promise<void> {
		const target = this.repository.target as Partial<EntityWithCache>;

		if (!target?.NAME || !target.HAS_CACHE) {
			return;
		}

		await cleanEntityCacheMany({ NAME: target.NAME, HAS_CACHE: true }, ids);
	}

	// IN operator requires array
	filterBy(
		column: string,
		value: (string | number)[],
		operator: 'IN' | 'NOT IN',
	): this;
	// All other operators require scalar
	filterBy(
		column: string,
		value?: string | number | boolean | null,
		operator?:
			| '='
			| '!='
			| '>='
			| '<='
			| '>'
			| '<'
			| 'LIKE'
			| 'ILIKE'
			| 'START_LIKE'
			| 'END_LIKE',
	): this;
	// Implementation
	filterBy(column: string, value?: QueryValue, operator: string = '='): this {
		if (value === undefined || value === null) {
			return this;
		}

		if (!['IN', 'NOT IN'].includes(operator) && Array.isArray(value)) {
			throw new CustomError(
				500,
				'`value` cannot be an array for operator other than `IN` or `NOT IN`',
			);
		}

		switch (operator) {
			case '=':
				if (column.endsWith('_id') || column.endsWith('.id')) {
					this.hasFilter = true;
				}
				break;
			case 'IN':
			case 'NOT IN':
				if (column.endsWith('_id') || column.endsWith('.id')) {
					this.hasFilter = true;
				}
				break;
			case 'LIKE':
			case 'ILIKE':
				value = `%${value}%`;
				break;
			case 'START_LIKE':
			case 'START_ILIKE':
				operator = 'LIKE';
				value = `${value}%`;
				break;
			case 'END_LIKE':
			case 'END_ILIKE':
				operator = 'LIKE';
				value = `%${value}`;
				break;
		}

		const columnKey = this.safeColumnKey(column);

		this.query.andWhere(
			this.buildWhereCondition(column, columnKey, operator),
			{ [columnKey]: value },
		);

		return this;
	}

	filterAny(filters: FilterByPropsType[]): this {
		const conditions: string[] = [];
		const params: QueryParams = {};

		filters.forEach((filter) => {
			if (filter.value === undefined || filter.value === null) {
				return;
			}

			let operator = filter.operator;
			let value = filter.value;

			if (operator !== 'IN' && Array.isArray(value)) {
				throw new CustomError(
					500,
					'`value` cannot be an array for operator other than `IN` or `NOT IN`',
				);
			}

			switch (operator) {
				case 'LIKE':
				case 'ILIKE':
					value = `%${value}%`;
					break;
				case 'START_LIKE':
				case 'START_ILIKE':
					operator = 'LIKE';
					value = `${value}%`;
					break;
				case 'END_LIKE':
				case 'END_ILIKE':
					operator = 'LIKE';
					value = `%${value}`;
					break;
			}

			const columnKey = this.safeColumnKey(filter.column);

			conditions.push(
				this.buildWhereCondition(filter.column, columnKey, operator),
			);

			params[columnKey] = value;
		});

		if (conditions.length > 0) {
			this.query.andWhere(
				new Brackets((qb) => {
					qb.where(conditions.join(' OR '), params);
				}),
			);
		}

		return this;
	}

	/**
	 * Add a raw SQL filter condition
	 *
	 * @param sql - Raw SQL condition (e.g., "to_tsvector('simple', name) @@ plainto_tsquery('simple', :term)")
	 * @param parameters - Parameters for the SQL condition
	 * @returns this instance for chaining
	 */
	filterRaw(
		sql: string | ((qb: SelectQueryBuilder<TEntity>) => string),
		parameters: Record<string, QueryValue> = {},
	): this {
		if (typeof sql === 'function') {
			this.query.andWhere(
				sql as (qb: SelectQueryBuilder<TEntity>) => string,
			);
		} else {
			this.query.andWhere(sql, parameters);
		}

		return this;
	}

	filterByRange(
		column: string,
		min?: Date | number | null,
		max?: Date | number | null,
	): this {
		// Pass Date objects directly to TypeORM - avoids timezone issues from string formatting
		const minValue = min ?? undefined;
		const maxValue = max ?? undefined;

		if (minValue !== undefined && maxValue !== undefined) {
			const stringColumn = this.safeColumnKey(column);
			const preparedColumn = this.prepareColumn(column);

			this.query.andWhere(
				`${preparedColumn} BETWEEN :min${stringColumn} AND :max${stringColumn}`,
				{
					[`min${stringColumn}`]: minValue,
					[`max${stringColumn}`]: maxValue,
				},
			);
		} else if (minValue !== undefined) {
			this.filterBy(column, minValue as number, '>=');
		} else if (maxValue !== undefined) {
			this.filterBy(column, maxValue as number, '<=');
		}

		return this;
	}

	/**
	 * Filters on the primary key, by one id or by several.
	 *
	 * A list goes through `IN` and is skipped when empty - an empty array would otherwise reach
	 * Postgres as `IN ()`, a syntax error rather than a query answering with no rows. Either
	 * form marks the query as filtered, so a `delete`/`restore` scoped to a set of ids is
	 * accepted where an unfiltered one is refused.
	 */
	filterById(id?: number | readonly number[] | null) {
		if (Array.isArray(id)) {
			if (id.length > 0) {
				this.hasFilter = true;
				this.filterBy('id', [...id], 'IN');
			}

			return this;
		}

		if (id) {
			this.hasFilter = true;
			this.filterBy('id', id as number);
		}

		return this;
	}

	/**
	 * Boolean columns stay out of `filterBy`, whose scalar overload is `string | number`: widening
	 * it would also let a flag reach the `LIKE` branches, where it means nothing. The value is
	 * bound as a parameter here, exactly as `filterBy` does.
	 */
	filterByBoolean(column: string, value?: boolean | null): this {
		if (value === undefined || value === null) {
			return this;
		}

		const columnKey = this.safeColumnKey(column);

		this.query.andWhere(`${this.prepareColumn(column)} = :${columnKey}`, {
			[columnKey]: value,
		});

		return this;
	}

	filterByStatus(status?: string | null) {
		if (status) {
			this.filterBy('status', status);
		}

		return this;
	}

	/**
	 * Turns arbitrary user input into a safe `to_tsquery` argument.
	 *
	 * Splitting on whitespace alone is not enough: `to_tsquery` has a grammar, and the
	 * operators in it (`& | ! ( ) : <->` and a trailing backslash) are exactly the characters a
	 * search box collects by accident. `to_tsquery('simple', 'foo(bar:*')` does not return
	 * nothing, it raises a syntax error - which surfaces as a 500 for anyone typing an opening
	 * bracket. Splitting on "not a letter or digit" removes the whole class at once, in any
	 * alphabet, rather than escaping a list that has to stay in sync with Postgres.
	 *
	 * Returns an empty string when nothing survives (`"+++"`, `"()"`). **Callers must skip the
	 * filter in that case** - `to_tsquery('simple', ':*')` is itself a syntax error.
	 *
	 * @param {string} term - Raw search input
	 * @returns {string} - `&`-joined tokens, or '' when the input carried no searchable text
	 */
	prepareTsTerm(term: string): string {
		return term
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((token) => token !== '')
			.join(' & ');
	}

	static isUniqueViolation(e: unknown): boolean {
		return e instanceof QueryFailedError && e.driverError?.code === '23505';
	}

	static getTreeRepository(entity: EntityTarget<ObjectLiteral>) {
		return dataSource.getTreeRepository(entity);
	}
}

export default RepositoryAbstract;
