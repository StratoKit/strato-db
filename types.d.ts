declare module 'strato-db'

type DBCallback = (db: DB) => Promise<unknown> | unknown
/** The types that SQLite can handle as parameter values */
type SQLiteValue = string | number | null
type SQLiteParam = SQLiteValue | boolean
type SQLiteMeta = {lastID: number; changes: number}
type SQLiteRow = Record<string, null | string | number>
type SQLiteColumnType =
	| 'TEXT'
	| 'NUMERIC'
	| 'INTEGER'
	| 'REAL'
	| 'BLOB'
	| 'JSON'

type DBEachCallback = (row: SQLiteRow) => Promise<unknown> | unknown

type SqlTag = (
	tpl: TemplateStringsArray,
	...interpolations: SQLiteParam[]
) => [string, string[]]

interface Statement {
	isStatement: true
	sql: string
	db: SQLite
	/** Closes the statement, removing it from the SQLite instance */
	finalize(): Promise<void>
	/** Run the statement and return the metadata. */
	run(vars: SQLiteParam[]): Promise<SQLiteMeta>
	/** Return the first row for the statement result. */
	get(vars: SQLiteParam[]): Promise<SQLiteRow | undefined>
	/** Return all result rows for the statement. */
	all(vars: SQLiteParam[]): Promise<SQLiteRow[]>
	/** Run the callback on each row of the result */
	each(vars: SQLiteParam[], onRow: DBEachCallback): Promise<void>
}

type SQLiteOptions = {
	/** Path to db file. */
	file?: string
	/** Open read-only. */
	readOnly?: boolean
	/** Verbose errors. */
	verbose?: boolean
	/** Called before opening. */
	onWillOpen?: () => Promise<unknown> | unknown
	/** Called after opened. */
	onDidOpen?: DBCallback
	/** Name for debugging. */
	name?: string
	/** Run incremental vacuum. */
	autoVacuum?: boolean
	/** Seconds between incremental vacuums. */
	vacuumInterval?: number
	/** Number of pages to clean per vacuum. */
	vacuumPageCount?: number
}

/**
 * SQLite is a wrapper around a single SQLite connection (via node-sqlite3). It
 * provides a Promise API, lazy opening, auto-cleaning prepared statements and
 * safe `db.run`select * from foo where bar=${bar}` ` templating. emits these
 * events, all without parameters:
 *
 * - 'begin': transaction begins
 * - 'rollback': transaction finished with failure
 * - 'end': transaction finished successfully
 * - 'finally': transaction finished
 * - 'call': call to SQLite completed, includes data and duration
 */
// eslint-disable-next-line unicorn/prefer-event-target
declare class SQLite extends EventEmitter {
	constructor(options?: SQLiteOptions)

	/** Holding space for models */
	store: object

	/**
	 * Template Tag for SQL statements.
	 *
	 * @example
	 * 	`` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
	 * 	${obj}JSON` ``
	 *
	 * 	is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
	 * 	JSON.stringify(obj)])`
	 */
	sql: {quoteId: (id: SQLiteParam) => string} & SqlTag
	/** `true` if an sqlite connection was set up. Mostly useful for tests. */
	isOpen: boolean
	/**
	 * Force opening the database instead of doing it lazily on first access.
	 *
	 * @returns - A promise for the DB being ready to use.
	 */
	open(): Promise<void>
	/**
	 * Close the database connection, including the prepared statements.
	 *
	 * @returns - A promise for the DB being closed.
	 */
	close(): Promise<void>
	/**
	 * Runs the passed function once, either immediately if the connection is
	 * already open, or when the database will be opened next. Note that if the
	 * function runs immediately, its return value is returned. If this is a
	 * Promise, it is the caller's responsibility to handle errors. Otherwise, the
	 * function will be run once after onDidOpen, and errors will cause the open
	 * to fail.
	 *
	 * @returns Either the function return value or undefined.
	 */
	runOnceOnOpen(fn: (db: SQLite) => void): void
	/**
	 * Return all rows for the given query.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [vars] - The variables to be bound to the statement.
	 */
	all(sql: string, vars?: SQLiteParam[]): Promise<SQLiteRow[]>
	all(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<SQLiteRow[]>
	/**
	 * Return the first row for the given query.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [vars] - The variables to be bound to the statement.
	 */
	get(sql: string, vars?: SQLiteParam[]): Promise<SQLiteRow | undefined>
	get(
		sql: TemplateStringsArray,
		...vars: SQLiteParam[]
	): Promise<SQLiteRow | undefined>
	/**
	 * Run the given query and return the metadata.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [vars] - The variables to be bound to the statement.
	 */
	run(sql: string, vars?: SQLiteParam[]): Promise<SQLiteMeta>
	run(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<SQLiteMeta>
	/**
	 * Run the given query and return nothing. Slightly more efficient than
	 * {@link run}.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [vars] - The variables to be bound to the statement.
	 * @returns - A promise for execution completion.
	 */
	exec(sql: string, vars?: SQLiteParam[]): Promise<void>
	exec(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<void>
	/**
	 * Register an SQL statement for repeated running. This will store the SQL and
	 * will prepare the statement with SQLite whenever needed, as well as finalize
	 * it when closing the connection.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [name] - A short name to use in debug logs.
	 */
	prepare(sql: string, name?: string): Statement
	/**
	 * Run the given query and call the function on each item. Note that
	 * node-sqlite3 seems to just fetch all data in one go.
	 *
	 * @param sql - The SQL statement to be executed.
	 * @param [vars] - The variables to be bound to the statement.
	 * @param cb - The function to call on each row.
	 * @returns - A promise for execution completion.
	 */
	each(
		...args:
			| [sql: string, cb: DBEachCallback]
			| [sql: string, vars: SQLiteParam[], cb: DBEachCallback]
	): Promise<void>
	/**
	 * Returns the data_version, which increases when other connections write to
	 * the database.
	 */
	dataVersion(): Promise<number>
	/**
	 * Returns or sets the user_version, an arbitrary integer connected to the
	 * database.
	 *
	 * @param [newV] - If given, sets the user version.
	 * @returns - The user version or nothing when setting.
	 */
	userVersion(newV?: number): Promise<number | void>
	/**
	 * Run a function in an immediate transaction. Within a connection, the
	 * invocations are serialized, and between connections it uses busy retry
	 * waiting. During a transaction, the database can still be read.
	 *
	 * @param fn - The function to call. It doesn't get any parameters.
	 * @returns - A promise for transaction completion.
	 */
	withTransaction(fn: () => Promise<void>): Promise<void>
}
type DBUpMigration = {up: DBCallback}
type DBMigration = DBUpMigration | DBCallback
/** Migrations are marked completed by their name in the `{sdb} migrations` table */
type DBMigrations = Record<string, DBMigration>
interface DBModel<Options extends {db: DB} = {db: DB}> {
	new (options: Options): any
}
type DBOptions = {
	/** Open the DB read-only */
	readOnly?: boolean
	migrations?: (DBUpMigration & {runKey: string})[]
	/** Called before migrations run. Not called for read-only */
	onBeforeMigrations?: (...params: any[]) => any
	/**
	 * Called after migrations ran. If readOnly is set, it runs after opening DB.
	 * The DB is open after this function resolves.
	 */
	onDidOpen?: (...params: any[]) => any
} & SQLiteOptions

/**
 * DB adds model management and migrations to Wrapper. The migration state is
 * kept in the table ""{sdb} migrations"".
 */
declare class DB extends SQLite {
	/** @param {DBOptions} options */
	constructor(options: DBOptions)

	/** The models. */
	store: Record<string, InstanceType<DBModel>>

	/**
	 * Add a model to the DB, which will manage one or more tables in the SQLite
	 * database. The model should use the given `db` instance at creation time.
	 *
	 * @param Model - A class to be instatiated with the DB.
	 * @param options - Options passed during Model creation as `{...options,
	 *   db}`.
	 * @returns - The created Model instance.
	 */
	addModel<
		Options = Record<string, any>,
		T extends DBModel<Options & {db: DB}> = DBModel<Options & {db: DB}>,
	>(Model: T, options?: Options): InstanceType<T>
	/**
	 * Register an object with migrations. Migrations are marked completed by the
	 * given name + their name in the `{sdb} migrations` table.
	 *
	 * @param groupName - The name under which to register these migrations.
	 * @param migrations - The migrations object.
	 */
	registerMigrations(groupName: string, migrations: DBMigrations): void
	/**
	 * Runs the migrations in a transaction and waits for completion.
	 *
	 * @param db - An opened SQLite instance.
	 * @returns - Promise for completed migrations.
	 */
	runMigrations(db: SQLite): Promise<void>
}

/** A callback receiving an item */
type ItemCallback<Item> = (obj: Item) => Promise<unknown> | unknown

/** The value of the stored objects' id */
type IDValue = string | number

type ColumnKeyToType<
	Column,
	Type = NonNullable<Column extends {type: any} ? Column['type'] : Column>,
> = Type extends string
	? string
	: Type extends 'INTEGER'
		? number
		: Type extends 'TEXT'
			? string
			: Type extends 'REAL'
				? number
				: Type extends 'BLOB'
					? Buffer
					: Type extends 'BOOLEAN'
						? boolean
						: Type extends boolean | number | string | Date
							? Type
							: never

/**
 * Search for simple values. Keys are column names, values are what they should
 * equal
 */
type JMSearchAttrs<Columns> = {
	[attr in keyof Columns]?: ColumnKeyToType<Columns[attr]>
}

/** The key for the column definition */
type JMColName = string

type Loader<T, U> = import('dataloader')<U, T | undefined>
/** A lookup cache, managed by DataLoader */
type JMCache<Item extends Record<string, any>, IDCol extends string> = {
	[name: string]: Loader<Item, Item[IDCol]>
}

type JMIndexOpions = boolean | 'ALL' | 'SPARSE'

/** A real or virtual column definition in the created sqlite table */
type JMColumnDef<Item = Record<string, any>> = {
	/** The column key, used for the column name if it's a real column. */
	name?: JMColName
	/** Is this a real table column. */
	real?: boolean
	/** Sql column type as accepted by DB. */
	type?: SQLiteColumnType
	/** Path to the value in the object. */
	path?: string
	/** INTEGER id column only: apply AUTOINCREMENT on the column. */
	autoIncrement?: boolean
	/** The alias to use in SELECT statements. */
	alias?: string
	/** Should the column be included in search results. */
	get?: boolean
	/** Process the value after getting from DB. */
	parse?: (colVal: SQLiteValue) => any
	/** Process the value before putting into DB. */
	stringify?: (val: any) => SQLiteParam
	/**
	 * The value is an object and must always be there. If this is a real column,
	 * a NULL column value will be replaced by `{}` and vice versa.
	 */
	alwaysObject?: boolean
	/**
	 * Function getting object and returning the value for the column; this
	 * creates a real column. Right now the column value is not regenerated for
	 * existing rows.
	 */
	value?: (object: Item) => any
	/** Same as value, but the result is used to generate a unique slug. */
	slugValue?: (object: Item) => any
	/** Any sql expression to use in SELECT statements. */
	sql?: string
	/** If the value is nullish, this will be stored instead. */
	default?: any
	/** Throw when trying to store a NULL. */
	required?: boolean
	/**
	 * Store/retrieve this boolean value as either `true` or absent from the
	 * object.
	 */
	falsyBool?: boolean
	/** Should it be indexed? If `unique` is false, NULLs are never indexed. */
	index?: JMIndexOpions
	/** Are null values ignored in the index?. */
	ignoreNull?: boolean
	/** Should the index enforce uniqueness?. */
	unique?: boolean
	/**
	 * A function receiving the search value and returning an array of values to
	 * be used in the `where` clause. The function should return falsy to skip the
	 * search, or an array of 0 or more values corresponding to the `?` in the
	 * `where` clause.
	 */
	whereVal?: (
		val: unknown
	) => SQLiteParam[] | false | undefined | null | unknown
	/**
	 * The where clause for querying, or a function returning one given `(value,
	 * origValue)`. The `value` is the search value (anything) or the result of
	 * `whereVal` (an array of sqlite params). The `origValue` is the search
	 * value.
	 */
	where?: string | ((value: unknown, origValue: unknown) => unknown[])
	/** This column contains an array of values. */
	isArray?: boolean
	/** To query, this column value must match one of the given array items. */
	in?: boolean
	/**
	 * [isArray only] to query, this column value must match all of the given
	 * array items.
	 */
	inAll?: boolean
	/** Perform searches as substring search with LIKE. */
	textSearch?: boolean
	/** Alias for isArray+inAll. */
	isAnyOfArray?: boolean
}
type JMColumnDefOrFn<Item> =
	| (({name: string}) => JMColumnDef<Item>)
	| JMColumnDef<Item>

/** A function that performs a migration before the DB is opened */
type JMMigration<T extends {[x: string]: any}, IDCol extends string> = (
	args: Record<string, any> & {db: DB; model: JsonModel<T, IDCol>}
) => Promise<void>

type JMColumns<Item = Record<string, any>, IDCol extends string = 'id'> = {
	[colName: string]: JMColumnDefOrFn<Item> | undefined
} & {
	[id in IDCol]?: JMColumnDef<Item>
}
/** @deprecated Use JMColumns instead - typo */
type JMColums = JMColumns
type JMOptions<
	T extends {[x: string]: any},
	IDCol extends string = 'id',
	Columns extends JMColumns<T, IDCol> = {[id in IDCol]?: {type: 'TEXT'}},
> = {
	/** A DB instance, normally passed by DB */
	db: DB
	/** The table name */
	name: string
	/** An object with migration functions. They are run in alphabetical order */
	migrations?: {[tag: string]: JMMigration<T, IDCol>}
	/** Free-form data passed to the migration functions */
	migrationOptions?: Record<string, any>
	/** The column definitions */
	columns?: Columns
	/**
	 * An object class to use for results, must be able to handle
	 * `Object.assign(item, result)`
	 */
	ItemClass?: object
	/** The key of the IDCol column */
	idCol?: IDCol
	/** Preserve row id after vacuum */
	keepRowId?: boolean
}

/**
 * Keys: literal WHERE clauses that are AND-ed together.
 *
 * They are applied if the value is an array, and the number of items in the
 * array must match the number of `?` in the clause.
 */
type JMWhereClauses = {
	[key: string]: (string | number | boolean)[] | undefined | null | false
}

type JMSearchOptions<Columns> = {
	/** Literal value search, for convenience. */
	attrs?: JMSearchAttrs<Columns>
	/** Sql expressions as keys with arrays of applicable parameters as values. */
	where?: JMWhereClauses
	/** Arbitrary join clause. Not processed at all. */
	join?: string
	/** Values needed by the join clause. */
	joinVals?: unknown[]
	/**
	 * Object with sql expressions as keys and +/- for direction and precedence.
	 * Lower number sort the column first.
	 */
	sort?: Record<string, number>
	/** Max number of rows to return. */
	limit?: number
	/** Number of rows to skip. */
	offset?: number
	/** Override the columns to select. */
	cols?: string[]
	/** Opaque value telling from where to continue. */
	cursor?: string
	/** Do not calculate cursor. */
	noCursor?: boolean
	/** Do not calculate totals. */
	noTotal?: boolean
}

/**
 * Stores Item objects in a SQLite table. Pass the type of the item it stores
 * and the config so it can determine the columns
 */
declare class JsonModel<
	RealItem extends {[x: string]: any} = {id: string},
	// Allow the id column name as well for backwards compatibility
	ConfigOrID = 'id',
	IDCol extends string = ConfigOrID extends {idCol: string}
		? ConfigOrID['idCol']
		: ConfigOrID extends string
			? ConfigOrID
			: 'id',
	Item extends {[x: string]: any} = RealItem extends {[id in IDCol]?: unknown}
		? RealItem
		: RealItem & {[id in IDCol]: IDValue},
	Config = ConfigOrID extends string ? object : ConfigOrID,
	Columns extends JMColumns<Item, IDCol> = Config extends {columns: object}
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
			Item,
	SearchAttrs = JMSearchAttrs<Columns>,
	SearchOptions = JMSearchOptions<Columns>,
> {
	// TODO have it infer the columns from the call to super
	constructor(options: JMOptions<Item, IDCol, Columns>)
	/** The DB instance storing this model */
	db: SQLite
	/** The table name */
	name: string
	/** The SQL-quoted table name */
	quoted: string
	/** The name of the id column */
	idCol: IDCol
	/** The SQL-quoted name of the id column */
	idColQ: string
	/** The prototype of returned Items */
	Item: object
	/** The column definitions */
	columnArr: JMColumnDef[]
	/** The column definitions keyed by name */
	columns: Columns
	/** Parses a row as returned by sqlite */
	parseRow: (row: SQLiteRow, options?: SearchOptions) => Item
	/**
	 * Parses query options into query parts. Override this function to implement
	 * search behaviors.
	 */
	makeSelect(
		/** The query options. */
		options: SearchOptions
	): [string, SQLiteParam[], string[], string, SQLiteParam[]]
	/**
	 * Search the first matching object.
	 *
	 * @returns The result or undefined if no match.
	 */
	searchOne(
		/** Simple value attributes. */
		attrs: SearchAttrs,
		options?: SearchOptions
	): Promise<Item | undefined>
	/**
	 * Search the all matching objects.
	 *
	 * @returns - `{items[], cursor}`. If no cursor, you got all the results. If
	 *   `options.itemsOnly`, returns only the items array.
	 */
	search(
		/** Simple value attributes. */
		attrs?: SearchAttrs,
		options?: SearchOptions & {
			itemsOnly?: false
		}
	): Promise<{items: Item[]; cursor: string}>
	search(
		/** Simple value attributes. */
		attrs: SearchAttrs | null | undefined,
		options: SearchOptions & {
			/** Return only the items array. */
			itemsOnly: true
		}
	): Promise<Item[]>
	/**
	 * A shortcut for setting `itemsOnly: true` on {@link search}.
	 *
	 * @param attrs - Simple value attributes.
	 * @param [options] - Search options.
	 * @returns - The search results.
	 */
	searchAll(attrs: SearchAttrs, options?: SearchOptions): Promise<Item[]>
	/**
	 * Check for existence of objects. Returns `true` if the search would yield
	 * results.
	 *
	 * @returns The search results exist.
	 */
	exists(
		...args: [id: Item[IDCol]] | [attrs: SearchAttrs, options?: SearchOptions]
	): Promise<boolean>
	/**
	 * Count of search results.
	 *
	 * @returns - The count.
	 */
	count(attrs?: SearchAttrs, options?: SearchOptions): Promise<number>
	/** Numeric Aggregate Operation. */
	numAggOp(
		/** The SQL function, e.g. MAX. */
		op: string,
		/** The column to aggregate. */
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/** Maximum value. */
	max(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/** Minimum value. */
	min(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/** Sum values. */
	sum(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/** Average value. */
	avg(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Get all objects. This can result in out-of-memory errors.
	 *
	 * @returns - The table contents.
	 */
	all(): Promise<Item[]>
	/**
	 * Get an object by a unique value, like its ID.
	 *
	 * @returns - The object if it exists.
	 */
	get(
		/** The value for the column */
		id: SQLiteParam,
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<Item | undefined>
	/**
	 * Get several objects by their unique value, like their ID.
	 *
	 * @returns - The objects, or undefined where they don't exist, in order of
	 *   their requested ID.
	 */
	getAll(
		/** The values for the column */
		ids: SQLiteParam[],
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<(Item | undefined)[]>
	/**
	 * Get an object by a unique value, like its ID, using a cache. This also
	 * coalesces multiple calls in the same tick into a single query, courtesy of
	 * DataLoader.
	 *
	 * @returns - The object if it exists. It will be cached.
	 */
	getCached(
		/** The lookup cache. It is managed with DataLoader. */
		// We add the {} to allow easy initialization
		cache: JMCache<Item, IDCol> | object,
		/** The value for the column */
		id: SQLiteParam,
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<Item | undefined>
	/**
	 * Lets you clear all the cache or just a key. Useful for when you change only
	 * some items.
	 *
	 * @returns - The column cache, you can call `.prime(key, value)` on it to
	 *   insert a value.
	 */
	clearCache(
		/** The lookup cache. It is managed with DataLoader. */
		cache: JMCache<Item, IDCol>,
		id?: Item[IDCol],
		colName?: string
	): Loader<Item, Item[IDCol]>
	/**
	 * Iterate through search results. Calls `fn` on every result. The iteration
	 * uses a cursored search, so changes to the model during the iteration can
	 * influence the iteration. If you pass `concurrent` it will limit the
	 * concurrently called functions `batchSize` sets the paging size.
	 *
	 * @returns Table iteration completed.
	 */
	each(
		...args:
			| [cb: ItemCallback<Item>]
			| [attrs: SearchAttrs, cb: ItemCallback<Item>]
			| [
					attrs: SearchAttrs,
					opts: SearchOptions & {concurrent?: number; batchSize?: number},
					cb: ItemCallback<Item>,
			  ]
	): Promise<void>
	/**
	 * Insert or replace the given object into the database.
	 *
	 * @param obj - The object to store. If there is no `id` value (or whatever
	 *   the `id` column is named), one is assigned automatically.
	 * @param [insertOnly] - Don't allow replacing existing objects.
	 * @param [noReturn] - Do not return the stored object; an optimization.
	 * @returns - If `noReturn` is false, the stored object is fetched from the
	 *   DB.
	 */
	set(
		obj: Partial<Item>,
		insertOnly?: boolean,
		noReturn?: boolean
	): Promise<Item>
	/**
	 * Update or upsert an object. This uses a transaction if one is not active.
	 *
	 * @param obj - The changes to store, including the id field.
	 * @param [upsert] - Insert the object if it doesn't exist.
	 * @param [noReturn] - Do not return the stored object, preventing a query.
	 * @returns A copy of the stored object.
	 */
	update(
		obj: Partial<Item>,
		upsert?: boolean,
		noReturn?: boolean
	): Promise<Item>
	/**
	 * Update or upsert an object. This does not use a transaction so is open to
	 * race conditions if you don't run it in a transaction.
	 *
	 * @param obj - The changes to store, including the id field.
	 * @param [upsert] - Insert the object if it doesn't exist.
	 * @param [noReturn] - Do not return the stored object, preventing a query.
	 * @returns A copy of the stored object.
	 */
	updateNoTrans(
		obj: Partial<Item>,
		upsert?: false,
		noReturn?: boolean
	): Promise<Item>
	updateNoTrans(obj: Item, upsert: true, noReturn?: boolean): Promise<Item>
	/**
	 * Remove an object. If the object doesn't exist, this doesn't do anything.
	 *
	 * @param idOrObj - The id or the object itself.
	 * @returns A promise for the deletion.
	 */
	remove(idOrObj: Item[IDCol] | Item): Promise<void>
	/**
	 * "Rename" an object.
	 *
	 * @param oldId - The current ID. If it doesn't exist this will throw.
	 * @param newId - The new ID. If this ID is already in use this will throw.
	 * @returns A promise for the rename.
	 */
	changeId(oldId: Item[IDCol], newId: Item[IDCol]): Promise<void>
}

type ESEvent<T extends keyof EventTypes = keyof EventTypes> = {
	[E in T]: {
		/** The version */
		v: number
		/** Event type */
		type: E
		/** Ms since epoch of event */
		ts: number
		/** Event data */
		data: EventTypes[E]
		/** Event processing result */
		result?: Record<string, ReduceResult>
	}
}[T]

type EQOptions<T extends {[x: string]: any}> = JMOptions<T, 'v'> & {
	/** The table name, defaults to `"history"` */
	name?: string
	/** Should getNext poll forever? */
	forever?: boolean
	/** Add views to the database to assist with inspecting the data */
	withViews?: boolean
}
/** Creates a new EventQueue model, called by DB. */
interface EventQueue<
	RealItem extends ESEvent = ESEvent,
	Config extends Partial<EQOptions<RealItem>> = object,
	IDCol extends string = Config extends {idCol: string} ? Config['idCol'] : 'v',
	Item extends {[x: string]: any} = RealItem extends {[id in IDCol]?: unknown}
		? RealItem
		: RealItem & {[id in IDCol]: IDValue},
	Columns extends JMColumns<Item, IDCol> = Config extends {columns: object}
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
			{[colName in keyof Item]: object},
> extends JsonModel<
		RealItem,
		{
			idCol: 'v'
			columns: {
				v: true
				type: true
				ts: true
				data: true
				result: true
				size: true
			}
		} & Config,
		IDCol,
		Item,
		Columns
	> {
	new (options: EQOptions<RealItem>): this
	/**
	 * Get the highest version stored in the queue.
	 *
	 * @returns - The version.
	 */
	getMaxV(): Promise<number>
	/**
	 * Atomically add an event to the queue.
	 *
	 * @param type - Event type.
	 * @param [data] - Event data.
	 * @param [ts=Date.now()] - Event timestamp, ms since epoch. Default is
	 *   `Date.now()`
	 * @returns - Promise for the added event.
	 */
	add<T extends keyof EventTypes>(
		type: T,
		data?: EventTypes[T],
		ts?: number
	): Promise<T>
	/**
	 * Get the next event after v (gaps are ok). The wait can be cancelled by
	 * `.cancelNext()`.
	 *
	 * @param [v=0] - The version. Default is `0`
	 * @param [noWait=false] - Do not wait for the next event. Default is `false`
	 * @returns The event if found.
	 */
	getNext(v?: number, noWait?: boolean): Promise<T>
	/** Cancel any pending `.getNext()` calls */
	cancelNext(): void
	/**
	 * Set the latest known version. New events will have higher versions.
	 *
	 * @param v - The last known version.
	 */
	setKnownV(v: number): Promise<void>
}

type ReduceResult<T extends object = object> = Record<
	string,
	T[] | undefined
> & {error?: unknown}
type ReduxArgs<M, Store = unknown> = {
	cache: object
	model: InstanceType<M>
	event: ESEvent
	store: Store
	addEvent: AddEventFn
	isMainEvent: boolean
}

// 'fn' deref is used to make the definitions bivariant
type PreprocessorFn<M extends ESDBModel = ESModel> = {
	fn: (args: ReduxArgs<M>) => Promise<ESEvent | void> | ESEvent | void
}['fn']
type ReducerFn<M extends ESDBModel = ESModel> = {
	fn: (
		args: ReduxArgs<M>
	) => Promise<ReduceResult | void | false> | ReduceResult | void | false
}['fn']
type ApplyResultFn = {
	fn: (result: ReduceResult) => Promise<void>
}['fn']
type DeriverFn<M extends ESDBModel = ESModel> = {
	fn: (args: ReduxArgs<M> & {result?: ReduceResult}) => Promise<void>
}['fn']
type TransactFn<M extends ESDBModel = ESModel> = {
	fn: (
		args: Omit<ReduxArgs<M>, 'addEvent'> & {dispatch: DispatchFn}
	) => Promise<void>
}['fn']

interface EventTypes {}
type DispatchFn = <T extends keyof EventTypes>(
	...args:
		| [type: T, data: EventTypes[T], ts?: number]
		| [
				arg: EventTypes[T] extends undefined
					? {type: T; data?: EventTypes[T]; ts?: number}
					: {type: T; data?: EventTypes[T]; ts?: number},
		  ]
) => Promise<ESEvent>

type AddEventFn = (
	...args:
		| [type: T, data: EventTypes[T]]
		| [
				arg: EventTypes[T] extends undefined
					? {type: T; data?: EventTypes[T]}
					: {type: T; data?: EventTypes[T]},
		  ]
) => void

// TODO get from models config
type ESDBModelArgs = {
	name: string
	db: DB
	dispatch: DispatchFn
	migrationOptions: Record<string, any> & {queue: EventQueue}
	emitter: EventEmitter
}
interface ESDBModel {
	new (args: ESDBModelArgs): this
	name: string
	preprocessor(args: ReduxArgs<this>): Promise<ESEvent | void> | ESEvent | void
	reducer(
		args: ReduxArgs<this>
	): Promise<ReduceResult | void | false> | ReduceResult | void | false
	applyResult(result: ReduceResult): Promise<void>
	deriver(args: ReduxArgs<this> & {result?: ReduceResult}): Promise<void>
	transact(
		args: Omit<ReduxArgs<this>, 'addEvent'> & {dispatch: DispatchFn}
	): Promise<void>
}

type ESDBOptions = DBOptions & {
	/**
	 * @deprecated 'db' is no longer an option, pass the db options instead, e.g.
	 *   file, verbose, readOnly
	 */
	db?: never
	models: {[name: string]: ESDBModel}
	queue?: EventQueue
	queueFile?: string
	withViews?: boolean
	onWillOpen?: DBCallback
	onBeforeMigrations?: DBCallback
	onDidOpen?: DBCallback
}
interface EventSourcingDB extends EventEmitter {
	new (options: ESDBOptions): this

	/** The read-only models. Use these freely, they don't "see" transactions */
	store: object
	/** The writable models. Do not use. */
	rwStore: object
	/** DB instance for the read-only models */
	db: DB
	/** DB instance for the writable models */
	rwDb: DB
	/** Queue instance holding the events */
	queue: EventQueue

	/** Open the DBs */
	open(): Promise<void>

	/** Close the DBs */
	close(): Promise<void>

	checkForEvents(): Promise<void>

	waitForQueue(): Promise<void>

	startPolling(wantVersion?: number): Promise<void>

	stopPolling(): Promise<void>

	dispatch: DispatchFn

	getVersion(): Promise<number>

	handledVersion(v: number): Promise<void>
}

type EMOptions<T extends {[x: string]: any}, IDCol extends string> = JMOptions<
	T,
	IDCol
> & {
	/** The ESDB dispatch function */
	dispatch: DispatchFn
	/**
	 * Emit an event with type `es/INIT:${modelname}` at table creation time, to
	 * be used by custom reducers.
	 */
	init?: boolean
}

/**
 * ESModel is a drop-in wrapper around JsonModel to turn changes into events.
 *
 * Use it to convert your database to be event sourcing.
 *
 * Event data is encoded as an array: `[subtype, id, data, meta]` Subtype is one
 * of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`. `id` is filled in by the
 * preprocessor at the time of the event. `meta` is free-form data about the
 * event. It is just stored in the history table.
 *
 * For example: `model.set({foo: true})` would result in the event `[1, 1, {foo:
 * true}]` Pass the type of the item it stores and the config so it can
 * determine the columns
 */
// TODO fix Item vs Item type incompatibility
interface ESModel<
	RealItem extends {[x: string]: any} = {id: string},
	// Allow the id column name as well for backwards compatibility
	ConfigOrID = 'id',
	IDCol extends string = ConfigOrID extends {idCol: string}
		? ConfigOrID['idCol']
		: ConfigOrID extends string
			? ConfigOrID
			: 'id',
	Item extends {[x: string]: any} = RealItem extends {[id in IDCol]?: unknown}
		? RealItem
		: RealItem & {[id in IDCol]: IDValue},
	Config = ConfigOrID extends string ? object : ConfigOrID,
	Columns extends JMColumns<Item, IDCol> = Config extends {columns: object}
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
			Item,
	SearchAttrs = JMSearchAttrs<Columns>,
	SearchOptions = JMSearchOptions<Columns>,
> extends JsonModel<
			RealItem,
			ConfigOrID,
			IDCol,
			Item,
			Config,
			Columns,
			SearchAttrs,
			SearchOptions
		>,
		ESDBModel {
	new (options: EMOptions<Item, IDCol>): this
	REMOVE: 0
	SET: 1
	INSERT: 2
	UPDATE: 3
	SAVE: 4
	TYPE: string
	INIT: string
	event: {
		set: (
			obj: Partial<Item>,
			insertOnly?: boolean,
			meta?: unknown
		) => Pick<ESEvent, 'type' | 'data'>
		update: (
			obj: Partial<Item>,
			upsert?: boolean,
			meta?: unknown
		) => Pick<ESEvent, 'type' | 'data'>
		remove: (
			idOrObj: Item | Item[IDCol],
			meta?: unknown
		) => Pick<ESEvent, 'type' | 'data'>
	}

	/**
	 * Assigns the object id to the event at the start of the cycle. When
	 * subclassing ESModel, be sure to call this too
	 * (`ESModel.preprocessor(arg)`)
	 */
	preprocessor(args: ReduxArgs<this>): Promise<ESEvent | void> | ESEvent | void
	/**
	 * Calculates the desired change. ESModel will only emit `rm`, `ins`, `upd`
	 * and `esFail`.
	 */
	reducer(
		args: ReduxArgs<this>
	): Promise<ReduceResult | void | false> | ReduceResult | void | false
	/**
	 * Applies the result from the reducer.
	 *
	 * @param result - Free-form change descriptor.
	 * @returns - Promise for completion.
	 */
	applyResult(result: ReduceResult): Promise<void>

	/**
	 * Calculates the desired change. ESModel will only emit `rm`, `ins`, `upd`
	 * and `esFail`.
	 */
	deriver(args: ReduxArgs<this> & {result?: ReduceResult}): Promise<void>

	dispatch(...args: Parameters<DispatchFn>): Promise<ESEvent>
	/**
	 * Slight hack: use the writable state to fall back to JsonModel behavior.
	 * This makes deriver and migrations work without changes. Note: while
	 * writable, no events are created. Be careful.
	 *
	 * @param state - Writeable or not.
	 */
	setWritable(state: boolean): void
	/**
	 * Insert or replace the given object into the database.
	 *
	 * @param obj - The object to store. If there is no `id` value (or whatever
	 *   the `id` column is named), one is assigned automatically.
	 * @param [insertOnly] - Don't allow replacing existing objects.
	 * @param [noReturn] - Do not return the stored object; an optimization.
	 * @param [meta] - Extra metadata to store in the event but not in the object.
	 * @returns - If `noReturn` is false, the stored object is fetched from the
	 *   DB.
	 */
	set(
		obj: Partial<Item>,
		insertOnly?: boolean,
		noReturn?: boolean,
		meta?: unknown
	): Promise<Item>
	/**
	 * Update an existing object. Returns the current object.
	 *
	 * @param o - The data to store.
	 * @param [upsert] - If `true`, allow inserting if the object doesn't exist.
	 * @param [noReturn] - Do not return the stored object; an optimization.
	 * @param [meta] - Extra metadata to store in the event at `data[3]` but not
	 *   in the object.
	 * @returns - If `noReturn` is false, the stored object is fetched from the
	 *   DB.
	 */
	update(
		o: Partial<Item>,
		upsert?: boolean,
		noReturn?: boolean,
		meta?: unknown
	): Promise<Item>
	/**
	 * Remove an object.
	 *
	 * @param idOrObj - The id or the object itself.
	 * @param meta - Metadata, attached to the event only, at `data[3]`.
	 */
	remove(idOrObj: Item | Item[IDCol], meta?: unknown): Promise<void>
	/** ChangeId: not implemented yet, had no need so far */
	changeId(): Promise<void>
	/**
	 * Returns the next available integer ID for the model. Calling this multiple
	 * times during a redux cycle will give increasing numbers even though the
	 * database table doesn't change. Use this from the redux functions to assign
	 * unique ids to new objects. **Only works if the ID type is number.**
	 *
	 * @returns - The next usable ID.
	 */
	getNextId(): Promise<number>
}
