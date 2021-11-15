declare module 'strato-db'

type EventEmitter = import('events').EventEmitter

type DBCallback = (db: DB) => Promise<void> | void
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

type DBEachCallback = (row: SQLiteRow) => Promise<void> | void

type SqlTag = (
	tpl: TemplateStringsArray,
	...interpolations: SQLiteParam[]
) => [string, string[]]

interface Statement {
	isStatement: true
	sql: string
	/** Closes the statement, removing it from the SQLite instance */
	finalize(): Promise<void>
	/** Run the statement and return the metadata. */
	run(vars: SQLiteParam[]): Promise<SQLiteMeta>
	/** Return the first row for the statement result. */
	get(vars: SQLiteParam[]): Promise<SQLiteRow | null>
	/** Return all result rows for the statement. */
	all(vars: SQLiteParam[]): Promise<SQLiteRow[]>
	/** Run the callback on each row of the result */
	each(vars: SQLiteParam[], onRow: DBEachCallback): Promise<void>
}

type SQLiteOptions = {
	/** path to db file. */
	file?: string
	/** open read-only. */
	readOnly?: boolean
	/** verbose errors. */
	verbose?: boolean
	/** called before opening. */
	onWillOpen?: (...params: any[]) => any
	/** called after opened. */
	onDidOpen?: (...params: any[]) => any
	/** name for debugging. */
	name?: string
	/** run incremental vacuum. */
	autoVacuum?: boolean
	/** seconds between incremental vacuums. */
	vacuumInterval?: number
	/** number of pages to clean per vacuum. */
	vacuumPageCount?: number
}

/**
 * SQLite is a wrapper around a single SQLite connection (via node-sqlite3).
 * It provides a Promise API, lazy opening, auto-cleaning prepared statements
 * and safe ``db.run`select * from foo where bar=${bar}` `` templating.
 * emits these events, all without parameters:
 * * 'begin': transaction begins
 * * 'rollback': transaction finished with failure
 * * 'end': transaction finished successfully
 * * 'finally': transaction finished
 * * 'call': call to SQLite completed, includes data and duration
 */
interface SQLite extends EventEmitter {
	new (options?: SQLiteOptions)

	/**
	 * Template Tag for SQL statements.
	 *
	 * @example
	 *
	 * `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
	 * ${obj}JSON` ``
	 *
	 * is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
	 * JSON.stringify(obj)])`
	 *
	 */
	sql(): {quoteId: (id: SQLiteParam) => string} & SqlTag
	/**
	 * `true` if an sqlite connection was set up. Mostly useful for tests.
	 */
	isOpen: boolean
	/**
	 * Force opening the database instead of doing it lazily on first access.
	 *
	 * @returns - a promise for the DB being ready to use.
	 */
	open(): Promise<void>
	/**
	 * Close the database connection, including the prepared statements.
	 *
	 * @returns - a promise for the DB being closed.
	 */
	close(): Promise<void>
	/**
	 * Runs the passed function once, either immediately if the connection is
	 * already open, or when the database will be opened next.
	 * Note that if the function runs immediately, its return value is returned.
	 * If this is a Promise, it is the caller's responsibility to handle errors.
	 * Otherwise, the function will be run once after onDidOpen, and errors will
	 * cause the open to fail.
	 *
	 * @returns Either the function return value or undefined.
	 */
	runOnceOnOpen(fn: (db: SQLite) => void): void
	/**
	 * Return all rows for the given query.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 */
	all(sql: string, vars?: SQLiteParam[]): Promise<SQLiteRow[]>
	all(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<SQLiteRow[]>
	/**
	 * Return the first row for the given query.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 */
	get(sql: string, vars?: SQLiteParam[]): Promise<SQLiteRow | null>
	get(
		sql: TemplateStringsArray,
		...vars: SQLiteParam[]
	): Promise<SQLiteRow | null>
	/**
	 * Run the given query and return the metadata.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 */
	run(sql: string, vars?: SQLiteParam[]): Promise<SQLiteMeta>
	run(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<SQLiteMeta>
	/**
	 * Run the given query and return nothing. Slightly more efficient than
	 * {@link run}.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns - a promise for execution completion.
	 */
	exec(sql: string, vars?: SQLiteParam[]): Promise<void>
	exec(sql: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<void>
	/**
	 * Register an SQL statement for repeated running. This will store the SQL and
	 * will prepare the statement with SQLite whenever needed, as well as finalize
	 * it when closing the connection.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [name]  - a short name to use in debug logs.
	 */
	prepare(sql: string, name?: string): Statement
	/**
	 * Run the given query and call the function on each item.
	 * Note that node-sqlite3 seems to just fetch all data in one go.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @param cb      - the function to call on each row.
	 * @returns - a promise for execution completion.
	 */
	each(sql: string, cb: (row: SQLiteRow) => any): Promise<void>
	each(sql: string, vars: SQLiteParam[], cb: DBEachCallback): Promise<void>
	/**
	 * Returns the data_version, which increases when other connections write to
	 * the database.
	 */
	dataVersion(): Promise<number>
	/**
	 * Returns or sets the user_version, an arbitrary integer connected to the
	 * database.
	 *
	 * @param [newV]  - if given, sets the user version.
	 * @returns - the user version or nothing when setting.
	 */
	userVersion(newV?: number): Promise<number | void>
	/**
	 * Run a function in an immediate transaction. Within a connection, the
	 * invocations are serialized, and between connections it uses busy retry
	 * waiting. During a transaction, the database can still be read.
	 *
	 * @param fn  - the function to call. It doesn't get any parameters.
	 * @returns - a promise for transaction completion.
	 */
	withTransaction(fn: () => Promise<void>): Promise<void>
}

type DBMigration = {up: DBCallback} | DBCallback
/** Migrations are marked completed by their name in the `{sdb} migrations` table */
type DBMigrations = Record<string, DBMigration>
interface DBModel<Options extends {db: DB} = {db: DB}> {
	new (options: Options): DBModel<Options>
}
type DBOptions = {
	/** open the DB read-only */
	readOnly?: boolean
	migrations?: DBMigrations
	/** called before migrations run. Not called for read-only */
	onBeforeMigrations?: (...params: any[]) => any
	/** Called after migrations ran. If readOnly is set, it runs after opening DB.
	 * The DB is open after this function resolves. */
	onDidOpen?: (...params: any[]) => any
} & SQLiteOptions

/**
 * DB adds model management and migrations to Wrapper.
 * The migration state is kept in the table ""{sdb} migrations"".
 */
interface DB extends SQLite {
	new (options: DBOptions): DB

	/** The models. */
	store: Record<string, InstanceType<DBModel>>

	/**
	 * Add a model to the DB, which will manage one or more tables in the SQLite
	 * database.
	 * The model should use the given `db` instance at creation time.
	 *
	 * @param Model    - a class to be instatiated with the DB.
	 * @param options  - options passed during Model creation as `{...options,
	 *                 db}`.
	 * @returns - the created Model instance.
	 */
	addModel(Model: DBModel, options?: Record<string, any>): InstanceType<DBModel>
	/**
	 * Register an object with migrations.
	 * Migrations are marked completed by the given name + their name in the `{sdb}
	 * migrations` table.
	 *
	 * @param groupName   - the name under which to register these migrations.
	 * @param migrations  - the migrations object.
	 */
	registerMigrations(groupName: string, migrations: DBMigrations): void
	/**
	 * Runs the migrations in a transaction and waits for completion.
	 *
	 * @param db  - an opened SQLite instance.
	 * @returns - promise for completed migrations.
	 */
	runMigrations(db: SQLite): Promise<void>
}

/** A callback receiving an item */
type ItemCallback<Item> = (obj: Item) => Promise<void>

/** The value of the stored objects' id */
type IDValue = string | number

/** Search for simple values. Keys are column names, values are what they should equal */
type JMSearchAttrs<Columns> = {
	[attr in keyof Columns]?: any
}

/** The key for the column definition */
type JMColName = string

type Loader<T, U> = import('dataloader')<U, T | null>
/** A lookup cache, managed by DataLoader */
type JMCache<Item extends Record<string, any>, IDCol extends string> = {
	[name: string]: Loader<Item, Item[IDCol]>
}

/** A real or virtual column definition in the created sqlite table */
type JMColumnDef = {
	/** the column key, used for the column name if it's a real column.  */
	name?: JMColName
	/** is this a real table column. */
	real?: boolean
	/** sql column type as accepted by DB. */
	type?: SQLiteColumnType
	/** path to the value in the object. */
	path?: string
	/** INTEGER id column only: apply AUTOINCREMENT on the column. */
	autoIncrement?: boolean
	/** the alias to use in SELECT statements. */
	alias?: string
	/** should the column be included in search results. */
	get?: boolean
	/** process the value after getting from DB. */
	parse?: (val: SQLiteValue) => any
	/** process the value before putting into DB. */
	stringify?: (any) => SQLiteParam
	/** the value is an object and must always be there. If this is a real column, a NULL column value will be replaced by `{}` and vice versa. */
	alwaysObject?: boolean
	/** function getting object and returning the value for the column; this creates a real column. Right now the column value is not regenerated for existing rows. */
	value?: (object: Record<string, any>) => any
	/** same as value, but the result is used to generate a unique slug. */
	slugValue?: (object: Record<string, any>) => any
	/** any sql expression to use in SELECT statements. */
	sql?: string
	/** if the value is nullish, this will be stored instead. */
	default?: any
	/** throw when trying to store a NULL. */
	required?: boolean
	/** store/retrieve this boolean value as either `true` or absent from the object. */
	falsyBool?: boolean
	/** should it be indexed? If `unique` is false, NULLs are never indexed. */
	index?: boolean
	/** are null values ignored in the index?. */
	ignoreNull?: boolean
	/** should the index enforce uniqueness?. */
	unique?: boolean
	/** a function receiving `origVals` and returning the `vals` given to `where`. It should return falsy or an array of values. */
	whereVal?: (vals: any[]) => any
	/** the where clause for querying, or a function returning one given `(vals, origVals)`. */
	where?: string | ((vals: any[], origVals: any[]) => any)
	/** this column contains an array of values. */
	isArray?: boolean
	/** to query, this column value must match one of the given array items. */
	in?: boolean
	/** [isArray only] to query, this column value must match all of the given array items. */
	inAll?: boolean
	/** perform searches as substring search with LIKE. */
	textSearch?: boolean
	/** alias for isArray+inAll. */
	isAnyOfArray?: boolean
}
type JMColumnDefOrFn = (({name: string}) => JMColumnDef) | JMColumnDef

/** A function that performs a migration before the DB is opened */
type JMMigration<T, IDCol extends string> = (
	args: Record<string, any> & {db: DB; model: JsonModel<T, IDCol>}
) => Promise<void>

type JMColums<IDCol extends string = 'id'> = {
	[colName: string]: JMColumnDefOrFn
} & {
	[id in IDCol]?: JMColumnDef
}

type JMOptions<
	T,
	IDCol extends string = 'id',
	Columns extends JMColums<IDCol> = {[id in IDCol]?: {type: 'TEXT'}}
> = {
	/** a DB instance, normally passed by DB  */
	db: DB
	/** the table name  */
	name: string
	/** an object with migration functions. They are run in alphabetical order  */
	migrations?: {[tag: string]: JMMigration<T, IDCol>}
	/** free-form data passed to the migration functions  */
	migrationOptions?: Record<string, any>
	/** the column definitions */
	columns?: Columns
	/** an object class to use for results, must be able to handle `Object.assign(item, result)`  */
	ItemClass?: Object
	/** the key of the IDCol column  */
	idCol?: IDCol
	/** preserve row id after vacuum  */
	keepRowId?: boolean
}

/**
 * Keys: literal WHERE clauses that are AND-ed together.
 *
 * They are applied if the value is an array, and the number of items in the
 * array must match the number of `?` in the clause.
 */
type JMWhereClauses = {
	[key: string]: (string | number | boolean)[] | null | false
}

type JMSearchOptions<Columns> = {
	/** literal value search, for convenience. */
	attrs?: JMSearchAttrs<Columns>
	/** sql expressions as keys with arrays of applicable parameters as values. */
	where?: JMWhereClauses
	/** arbitrary join clause. Not processed at all. */
	join?: string
	/** values needed by the join clause. */
	joinVals?: any[]
	/** object with sql expressions as keys and +/- for direction and precedence. Lower number sort the column first. */
	sort?: Record<string, number>
	/** max number of rows to return. */
	limit?: number
	/** number of rows to skip. */
	offset?: number
	/** override the columns to select. */
	cols?: string[]
	/** opaque value telling from where to continue. */
	cursor?: string
	/** do not calculate cursor. */
	noCursor?: boolean
	/** do not calculate totals. */
	noTotal?: boolean
}

/**
 * Stores Item objects in a SQLite table.
 * Pass the type of the item it stores and the config so it can determine the columns
 */
interface JsonModel<
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
	Config = ConfigOrID extends string ? {} : ConfigOrID,
	Columns extends JMColums<IDCol> = Config extends {columns: {}}
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
		  {[colName in keyof Item]: {}},
	SearchAttrs = JMSearchAttrs<Columns>,
	SearchOptions = JMSearchOptions<Columns>
> {
	// TODO have it infer the columns from the call to super
	new (options: JMOptions<Item, IDCol, Columns>): this
	/** The DB instance storing this model */
	db: DB
	/** The table name */
	name: string
	/** The SQL-quoted table name */
	qouted: string
	/** The name of the id column */
	idCol: IDCol
	/** The SQL-quoted name of the id column */
	idColQ: string
	/** The prototype of returned Items */
	Item: Object
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
	 * @returns The result or null if no match.
	 */
	searchOne(
		/** Simple value attributes. */
		attrs: SearchAttrs,
		options?: SearchOptions
	): Promise<Item | null>
	/**
	 * Search the all matching objects.
	 *
	 * @returns - `{items[], cursor}`. If no cursor, you got all the results. If
	 *          `options.itemsOnly`, returns only the items array.
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
		attrs: SearchAttrs | null,
		options: SearchOptions & {
			/** Return only the items array. */
			itemsOnly: true
		}
	): Promise<Item[]>
	/**
	 * A shortcut for setting `itemsOnly: true` on {@link search}.
	 *
	 * @param attrs      - simple value attributes.
	 * @param [options]  - search options.
	 * @returns - the search results.
	 */
	searchAll(attrs: SearchAttrs, options?: SearchOptions): Promise<Item[]>
	/**
	 * Check for existence of objects. Returns `true` if the search would yield
	 * results.
	 *
	 * @returns The search results exist.
	 */
	exists(id: Item[IDCol]): Promise<boolean>
	exists(attrs: SearchAttrs, options?: SearchOptions): Promise<boolean>
	/**
	 * Count of search results.
	 *
	 * @returns - the count.
	 */
	count(attrs?: SearchAttrs, options?: SearchOptions): Promise<number>
	/**
	 * Numeric Aggregate Operation.
	 */
	numAggOp(
		/** The SQL function, e.g. MAX. */
		op: string,
		/** The column to aggregate. */
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Maximum value.
	 */
	max(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Minimum value.
	 */
	min(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Sum values.
	 */
	sum(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Average value.
	 */
	avg(
		colName: JMColName,
		attrs?: SearchAttrs,
		options?: SearchOptions
	): Promise<number>
	/**
	 * Get all objects. This can result in out-of-memory errors.
	 *
	 * @returns - the table contents.
	 */
	all(): Promise<Item[]>
	/**
	 * Get an object by a unique value, like its ID.
	 *
	 * @returns - the object if it exists.
	 */
	get(
		/** The value for the column */
		id: SQLiteParam,
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<Item | null>
	/**
	 * Get several objects by their unique value, like their ID.
	 *
	 * @returns - the objects, or null where they don't exist, in order of their
	 *          requested ID.
	 */
	getAll(
		/** The values for the column */
		ids: SQLiteParam[],
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<(Item | null)[]>
	/**
	 * Get an object by a unique value, like its ID, using a cache.
	 * This also coalesces multiple calls in the same tick into a single query,
	 * courtesy of DataLoader.
	 *
	 * @returns - the object if it exists. It will be cached.
	 */
	getCached(
		/** The lookup cache. It is managed with DataLoader. */
		// We add the {} to allow easy initialization
		cache: JMCache<Item, IDCol> | {},
		/** The value for the column */
		id: SQLiteParam,
		/** The column name, defaults to the ID column */
		colName?: JMColName
	): Promise<Item | null>
	/**
	 * Lets you clear all the cache or just a key. Useful for when you change only
	 * some items.
	 *
	 * @returns - the column cache, you can call `.prime(key, value)` on it to
	 *          insert a value.
	 */
	clearCache(
		/** The lookup cache. It is managed with DataLoader. */
		cache: JMCache<Item, IDCol>,
		id?: Item[IDCol],
		colName?: string
	): Loader<Item, Item[IDCol]>
	/**
	 * Iterate through search results. Calls `fn` on every result.
	 * The iteration uses a cursored search, so changes to the model during the
	 * iteration can influence the iteration.
	 *
	 * @returns Table iteration completed.
	 */
	each(cb: ItemCallback<Item>): Promise<void>
	each(attrs: SearchAttrs, cb: ItemCallback<Item>): Promise<void>
	each(
		attrs: SearchAttrs,
		opts: SearchOptions,
		cb: ItemCallback<Item>
	): Promise<void>
	/**
	 * Insert or replace the given object into the database.
	 *
	 * @param obj           - the object to store. If there is no `id` value (or
	 *                      whatever the `id` column is named), one is assigned
	 *                      automatically.
	 * @param [insertOnly]  - don't allow replacing existing objects.
	 * @param [noReturn]    - do not return the stored object; an optimization.
	 * @returns - if `noReturn` is false, the stored object is fetched from the
	 *          DB.
	 */
	set(
		obj: Partial<Item>,
		insertOnly?: boolean,
		noReturn?: boolean
	): Promise<Item>
	/**
	 * Update or upsert an object. This uses a transaction if one is not active.
	 *
	 * @param obj         - The changes to store, including the id field.
	 * @param [upsert]    - Insert the object if it doesn't exist.
	 * @param [noReturn]  - Do not return the stored object, preventing a query.
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
	 * @param obj         - The changes to store, including the id field.
	 * @param [upsert]    - Insert the object if it doesn't exist.
	 * @param [noReturn]  - Do not return the stored object, preventing a query.
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
	 * @param idOrObj  - The id or the object itself.
	 * @returns A promise for the deletion.
	 */
	remove(idOrObj: Item[IDCol] | Item): Promise<void>
	/**
	 * "Rename" an object.
	 *
	 * @param oldId  - The current ID. If it doesn't exist this will throw.
	 * @param newId  - The new ID. If this ID is already in use this will throw.
	 * @returns A promise for the rename.
	 */
	changeId(oldId: Item[IDCol], newId: Item[IDCol]): Promise<void>
}

type ESEvent = {
	/** the version */
	v: number
	/** event type */
	type: string
	/** ms since epoch of event */
	ts: number
	/** event data */
	data?: any
	/** event processing result */
	result?: Record<string, ReduceResult>
}
type EQOptions<T> = JMOptions<T, 'v'> & {
	/** the table name, defaults to `"history"` */
	name?: string
	/** should getNext poll forever? */
	forever?: boolean
	/** add views to the database to assist with inspecting the data */
	withViews?: boolean
}
/**
 * Creates a new EventQueue model, called by DB.
 */
interface EventQueue<
	T extends ESEvent = ESEvent,
	Config extends Partial<EQOptions<T>> = {}
> extends JsonModel<
		T,
		{idCol: 'v'; columns: import('./dist/EventQueue').Columns} & Config
	> {
	new (options: EQOptions<T>): this
	/**
	 * Get the highest version stored in the queue.
	 *
	 * @returns - the version.
	 */
	getMaxV(): Promise<number>
	/**
	 * Atomically add an event to the queue.
	 *
	 * @param type             - event type.
	 * @param [data]           - event data.
	 * @param [ts=Date.now()]  - event timestamp, ms since epoch.
	 * @returns - Promise for the added event.
	 */
	add(type: string, data?: any, ts?: number): Promise<T>
	/**
	 * Get the next event after v (gaps are ok).
	 * The wait can be cancelled by `.cancelNext()`.
	 *
	 * @param [v=0]           - the version.
	 * @param [noWait=false]  - do not wait for the next event.
	 * @returns The event if found.
	 */
	getNext(v?: number, noWait?: boolean): Promise<T>
	/**
	 * Cancel any pending `.getNext()` calls
	 */
	cancelNext(): void
	/**
	 * Set the latest known version.
	 * New events will have higher versions.
	 *
	 * @param v  - the last known version.
	 */
	setKnownV(v: number): Promise<void>
}

type ReduceResult = Record<string, any>
type ReduxArgs<M extends ESDBModel> = {
	cache: {}
	model: InstanceType<M>
	event: ESEvent
	store: EventSourcingDB['store']
	addEvent: AddEventFn
	isMainEvent: boolean
}
type PreprocessorFn<M extends ESDBModel = ESModel<{}>> = (
	args: ReduxArgs<M>
) => Promise<ESEvent | null> | ESEvent | null
type ReducerFn<M extends ESDBModel = ESModel<{}>> = (
	args: ReduxArgs<M>
) => Promise<ReduceResult | null | false> | ReduceResult | null | false
type ApplyResultFn = (result: ReduceResult) => Promise<void>
type DeriverFn<M extends ESDBModel = ESModel<{}>> = (
	args: ReduxArgs<M> & {result: ReduceResult}
) => Promise<void>
type TransactFn<M extends ESDBModel = ESModel<{}>> = (
	args: Omit<ReduxArgs<M>, 'addEvent'> & {dispatch: DispatchFn}
) => Promise<void>

type DispatchFn = (type: string, data?: any, ts?: number) => Promise<ESEvent>
type AddEventFn = (type: string, data?: any) => void

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
	preprocessor?: PreprocessorFn<this>
	reducer?: ReducerFn<this>
	applyResult?: ApplyResultFn
	deriver?: DeriverFn<this>
	transact?: TransactFn<this>
}

type ESDBOptions = DBOptions & {
	models: {[name: string]: ESDBModel}
	queue?: InstanceType<EventQueue>
	queueFile?: string
	withViews?: boolean
	onWillOpen?: DBCallback
	onBeforeMigrations?: DBCallback
	onDidOpen?: DBCallback
}
interface EventSourcingDB extends EventEmitter {
	new (options: ESDBOptions): this

	/** The read-only models. Use these freely, they don't "see" transactions */
	store: Record<string, InstanceType<ESDBModel>>
	/** The writable models. Do not use. */
	rwStore: Record<string, InstanceType<ESDBModel>>
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

	dispatch(type: string, data?: any, ts?: number): Promise<ESEvent>

	getVersion(): Promise<number>

	handledVersion(v: number): Promise<void>
}

type EMOptions<T, IDCol extends string> = JMOptions<T, IDCol> & {
	/** the ESDB dispatch function */
	dispatch: DispatchFn
	/** emit an event with type `es/INIT:${modelname}` at table creation time, to be used by custom reducers.*/
	init?: boolean
}
/**
 * ESModel is a drop-in wrapper around JsonModel to turn changes into events.
 *
 * Use it to convert your database to be event sourcing.
 *
 * Event data is encoded as an array: `[subtype, id, data, meta]`
 * Subtype is one of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`.
 * `id` is filled in by the preprocessor at the time of the event.
 * `meta` is free-form data about the event. It is just stored in the history
 * table.
 *
 * For example: `model.set({foo: true})` would result in the event `[1, 1, {foo:
 * true}]`
 * Pass the type of the item it stores and the config so it can determine the columns
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
	Item extends {[x: string]: any} = RealItem extends {[id in IDCol]: unknown}
		? RealItem
		: RealItem & {[id in IDCol]: IDValue}
> extends JsonModel<Item, ConfigOrID, IDCol>,
		ESDBModel {
	new (options: EMOptions<Item, IDCol>): this
	REMOVE: 0
	SET: 1
	INSERT: 2
	UPDATE: 3
	SAVE: 4
	TYPE: string
	INIT: string

	/**
	 * Assigns the object id to the event at the start of the cycle.
	 * When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)
	 */
	preprocessor?: PreprocessorFn<this>
	/**
	 * Calculates the desired change.
	 * ESModel will only emit `rm`, `ins`, `upd` and `esFail`.
	 */
	reducer?: ReducerFn<this>
	/**
	 * Applies the result from the reducer.
	 *
	 * @param result  - free-form change descriptor.
	 * @returns - Promise for completion.
	 */
	applyResult?: ApplyResultFn
	/**
	 * Calculates the desired change.
	 * ESModel will only emit `rm`, `ins`, `upd` and `esFail`.
	 */
	deriver?: DeriverFn<this>

	dispatch: DispatchFn
	/**
	 * Slight hack: use the writable state to fall back to JsonModel behavior.
	 * This makes deriver and migrations work without changes.
	 * Note: while writable, no events are created. Be careful.
	 *
	 * @param state  - writeable or not.
	 */
	setWritable(state: boolean): void
	/**
	 * Insert or replace the given object into the database.
	 *
	 * @param obj           - the object to store. If there is no `id` value (or
	 *                      whatever the `id` column is named), one is assigned
	 *                      automatically.
	 * @param [insertOnly]  - don't allow replacing existing objects.
	 * @param [noReturn]    - do not return the stored object; an optimization.
	 * @param [meta]        - extra metadata to store in the event but not in
	 *                      the object.
	 * @returns - if `noReturn` is false, the stored object is fetched from the
	 *          DB.
	 */
	set(
		obj: Partial<Item>,
		insertOnly?: boolean,
		noReturn?: boolean,
		meta?: any
	): Promise<Item>
	/**
	 * Update an existing object. Returns the current object.
	 *
	 * @param o           - the data to store.
	 * @param [upsert]    - if `true`, allow inserting if the object doesn't
	 *                    exist.
	 * @param [noReturn]  - do not return the stored object; an optimization.
	 * @param [meta]      - extra metadata to store in the event at `data[3]`
	 *                    but not in the object.
	 * @returns - if `noReturn` is false, the stored object is fetched from the
	 *          DB.
	 */
	update(
		o: Partial<Item>,
		upsert?: boolean,
		noReturn?: boolean,
		meta?: any
	): Promise<Item>
	/**
	 * Remove an object.
	 *
	 * @param idOrObj  - the id or the object itself.
	 * @param meta     - metadata, attached to the event only, at `data[3]`.
	 */
	remove(idOrObj: Item | Item[IDCol], meta?: any): Promise<void>
	/**
	 * changeId: not implemented yet, had no need so far
	 */
	changeId(): Promise<void>
	/**
	 * Returns the next available integer ID for the model.
	 * Calling this multiple times during a redux cycle will give increasing
	 * numbers even though the database table doesn't change.
	 * Use this from the redux functions to assign unique ids to new objects.
	 * **Only works if the ID type is number.**
	 *
	 * @returns - the next usable ID.
	 */
	getNextId(): Promise<number>
}
