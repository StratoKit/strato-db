import debug from 'debug'
import jsurl from 'jsurl2'
import DB, {sql} from '../DB'
import DataLoader from 'dataloader'
import {get, set} from 'lodash'
import {normalizeColumn} from './normalizeColumn'
import {assignJsonParents} from './assignJsonParents'
import {
	parseJson,
	stringifyJsonObject,
	prepareSqlCol,
	byPathLength,
	byPathLengthDesc,
} from './prepareSqlCol'
import {verifyOptions, verifyColumn} from './verifyConfig'
import {makeMigrations} from './makeMigrations'
import {makeIdValue} from './makeDefaultIdValue'
import {settleAll} from '../lib/settleAll'
import {DEV, deprecated} from '../lib/warning'
import {
	SQLiteChangesMeta,
	SQLiteColumnType,
	SQLiteModel,
	SQLiteParam,
	SQLiteRow,
	SQLiteValue,
} from '../DB/SQLite'
import type Statement from '../DB/Statement'

const dbg = debug('strato-db/JSON')

export type ForSure<T, keys extends keyof T> = T & {[k in keys]-?: T[k]}
// type NotSure<T, keys extends keyof T> = Omit<T, keys> & {[k in keys]?: T[k]}
export type IIf<If, A, B> = If extends true ? A : B

/** A cursor */
export type JMCursor = string & {T?: 'cursor'}
/** Model name */
export type JMModelName = string & {T?: 'modelName'}
/** Column name */
export type JMColName = string & {T?: 'colName'}

/** A real or virtual column definition in the created sqlite table */
export type JMColumnDef<Item extends JMRecord = JMJsonRecord> = {
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
	parse?: (dbVal: SQLiteValue) => any
	/** process the value before putting into DB. */
	stringify?: (itemVal: any) => SQLiteParam
	/** the value is an object and must always be there. If this is a real column, a NULL column value will be replaced by `{}` and vice versa. */
	alwaysObject?: boolean
	/** function getting the item to store and returning the value for the column; this creates a real column. Right now the column value is not regenerated for existing rows. */
	value?: (item: Item) => any
	/** same as value, but the result is used to generate a unique slug. */
	slugValue?: (item: Item) => any
	/** any sql expression to use in SELECT statements. */
	sql?: string
	/** if the value is nullish, this will be stored instead. */
	default?: any
	/** throw when trying to store a NULL. */
	required?: boolean
	/** store/retrieve this boolean value as either `true` or absent from the object. */
	falsyBool?: boolean
	/** should it be indexed? false: no. true: if `unique` is false, NULLs are not indexed. SPARSE: index without NULL. ALL: index all values */
	index?: boolean | 'ALL' | 'SPARSE'
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
export type JMColumnFn = (args: {columnName: JMColName}) => JMColumnDef
export type JMColumnDefOrFn = JMColumnDef | JMColumnFn
export type JMNormalizedColumnDef<Item extends JMRecord> = ForSure<
	JMColumnDef<Item>,
	'alias' | 'get' | 'path' | 'sql'
> & {
	/** the column key, used for the column name if it's a real column.  */
	name: JMColName
	/** Column name quoted for SQL */
	quoted: string
	/** Path within the JSON object */
	parts: string[]
	/** The select column expression */
	select: string
	/** The alias */
	alias: string

	_getSql: Statement<SQLiteRow, [SQLiteValue]>
	_getAllSql: Statement<SQLiteRow, [string]>
	_changeIdSql: Statement<undefined, [SQLiteValue, SQLiteValue]>
}

/**
 * The value types that JsonModel can store without serializing.
 * Basically, anything that fits in a JSON column.
 */
export type JMValue =
	| string
	| number
	| boolean
	| null
	| JMValue[]
	| {[key: string]: JMValue}
/** The possible value types of the stored objects' id */
export type JMIDType = (string | number) & {I?: 'id'}
/** The minimum type JsonModel can store */
export type JMRecord = Record<string, any>
/** The minimum type JsonModel can store without column configuration */
export type JMJsonRecord = Record<string, JMValue>

export type IdRecord<IDCol extends string, IDType extends JMIDType> = {
	[id in IDCol]: IDType
}
export type JMObject<IDCol extends string, IDType extends JMIDType> = JMRecord &
	IdRecord<IDCol, IDType>
export type WithId<
	T extends JMRecord,
	IDCol extends string,
	IDType extends JMIDType,
> = Omit<T, IDCol> & IdRecord<IDCol, IDType>
export type MaybeId<
	T extends JMRecord,
	IDCol extends string,
	IDType extends JMIDType,
> = Omit<T, IDCol> & {[x in IDCol]?: IDType}

export type JMItemCallback<T> = (
	item: T,
	index: number
) => unknown | Promise<unknown>

export type JMMigrationExtraArgs = Record<string, any> | undefined

/** A function that performs a migration before the DB is opened */
export type JMMigration = <
	Model extends JsonModel = JsonModel,
	ExtraArgs extends JMMigrationExtraArgs = undefined,
>(
	args: ExtraArgs & {db: DB; model: Model}
) => unknown | Promise<unknown>
export type JMMigrations = {
	[tag: string]: JMMigration | {up: JMMigration} | null | undefined | false
}

export type JMColumns<IDCol extends JMColName = string> = Record<
	JMColName,
	JMColumnDefOrFn
> & {
	[id in IDCol]?: JMColumnDef
}

export type JMBaseConfig = {
	idCol?: string
	name: JMModelName
	columns?: JMColumns
	migrationOptions?: JMMigrationExtraArgs
}

export type JMConfig<
	IDCol extends JMColName,
	ItemType extends JMRecord,
	MigrationArgs extends JMMigrationExtraArgs,
> = {
	/** the table name  */
	name: JMModelName
	/** the key of the IDCol column  */
	idCol?: IDCol
	/** the column definitions */
	columns?: JMColumns<IDCol>
	/** an object with migration functions. They are run in alphabetical order  */
	migrations?: JMMigrations
	/** free-form data passed to the migration functions  */
	migrationOptions?: MigrationArgs
	/** an object class to use for results, must be able to handle `Object.assign(item, result)`  */
	ItemClass?: {new (): ItemType}
	/** preserve next available row id after vacuum  */
	keepRowId?: boolean
	/** @internal The  DB instance, for internal use. */
	db?: DB
}

type Loader<Key, Value> = DataLoader<Key, Value | undefined>
/** A lookup cache, managed by DataLoader */
export type JMCache<Item> = {
	[name: string]: Loader<SQLiteValue, Item>
}

/**
 * Keys: literal WHERE clauses that are AND-ed together.
 *
 * They are applied if the value is an array, and the number of items in the
 * array must match the number of `?` in the clause.
 */
export type JMWhereClauses = {
	[key: string]: (string | number | boolean)[] | undefined | null | false
}
/** Search for simple values. Keys are column names, values are what they should equal */
export type JMSearchAttrs<ColNames extends string> = {
	[attr in ColNames]?: any
}
export type JMSearchOptions<ColNames extends string> = {
	/** literal value search, for convenience. */
	attrs?: JMSearchAttrs<ColNames> | null
	/** sql expressions as keys with arrays of applicable parameters as values. */
	where?: JMWhereClauses
	/** arbitrary join clause. Not processed at all. */
	join?: string
	/** values needed by the join clause. */
	joinVals?: any[]
	/** object with sql expressions as keys and +/- for direction and precedence. Lower number sort the column first. */
	sort?: {[colName in ColNames]?: number}
	/** max number of rows to return. */
	limit?: number
	/** number of rows to skip. */
	offset?: number
	/** override the columns to select. */
	cols?: ColNames[]
	/** opaque value telling from where to continue. */
	cursor?: string
	/** do not calculate cursor. */
	noCursor?: boolean
	/** do not calculate totals. */
	noTotal?: boolean
}

export type JMEachOptions<O> = Omit<O, 'limit'> & {
	/** Number of callbacks running concurrently */
	concurrent?: number
	/** Number of results to fetch from the table per batch */
	batchSize?: number
	/** @deprecated Same as batchSize. Will become max total items to fetch. */
	limit?: number
	/** @deprecated */
	fn?: JMItemCallback<any>
}

const encodeCursor = (
	row: SQLiteRow,
	cursorKeys: string[],
	invert?: boolean
): JMCursor => {
	const encoded = jsurl.stringify(
		cursorKeys.map(k => row[k]),
		{short: true}
	)
	return invert ? `!${encoded}` : encoded
}
const decodeCursor = (cursor?: JMCursor) => {
	let cursorVals: any[] | undefined,
		invert = false
	if (cursor) {
		if (cursor.startsWith('!!')) {
			invert = true
			cursor = cursor.slice(1)
		}
		cursorVals = jsurl.parse(cursor) as any[]
	}
	return {cursorVals, invert}
}

export type SearchResults<DBItem> = {
	/** The array of results */
	items: DBItem[]
	/** The total number of results or undefined if options.noTotal */
	total?: number
	/** The cursor for the next page or undefined if no more items or options.noCursor */
	cursor?: JMCursor
	/** The cursor for the previous page or undefined if options.noCursor */
	prevCursor?: JMCursor
}

/**
 * JsonModel is a simple document store. It stores its data in SQLite as a table, one row
 * per object (document). Each object must have a unique ID, normally at `obj.id`.
 *
 * Generics are:
 * - The type of returned Item
 * - the configuration
 * - The type of input Item
 * - Column name of id
 */
class JsonModel<
	ItemType extends JMRecord = JMJsonRecord,
	Config extends JMBaseConfig = {name: 'unknown'},
	//
	// Inferred generics below
	//
	IDCol extends string = Config['idCol'] extends string
		? Config['idCol']
		: 'id',
	IDType extends JMIDType = ItemType[IDCol] extends JMIDType
		? ItemType[IDCol]
		: string,
	InputItem extends MaybeId<Partial<ItemType>, IDCol, IDType> = MaybeId<
		Partial<ItemType>,
		IDCol,
		IDType
	>,
	DBItem extends WithId<ItemType, IDCol, IDType> = WithId<
		ItemType,
		IDCol,
		IDType
	>,
	Name extends JMModelName = Config['name'],
	Columns extends JMColumns<IDCol> = Config['columns'] extends JMColumns<IDCol>
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
		  {[colName in keyof DBItem]: JMColumnDef},
	ColName extends string | IDCol | 'json' =
		| Extract<keyof Columns, string>
		| IDCol
		| 'json',
	SearchAttrs extends JMSearchAttrs<ColName> = JMSearchAttrs<ColName>,
	SearchOptions extends JMSearchOptions<ColName> = JMSearchOptions<ColName>,
	MigrationArgs extends
		JMMigrationExtraArgs = Config['migrationOptions'] extends JMMigrationExtraArgs
		? Config['migrationOptions']
		: JMMigrationExtraArgs,
	RealConfig extends JMConfig<IDCol, ItemType, MigrationArgs> = JMConfig<
		IDCol,
		ItemType,
		MigrationArgs
	>,
> implements SQLiteModel
{
	/** The DB instance storing this model */
	declare db: DB
	/** The table name */
	declare name: Name
	/** The SQL-quoted table name */
	declare quoted: string
	/** The name of the id column */
	declare idCol: IDCol
	/** The SQL-quoted name of the id column */
	declare idColQ: string
	/** The prototype of returned Items */
	declare Item?: {new (): ItemType}
	/** The column definitions */
	declare columnArr: JMNormalizedColumnDef<DBItem>[]
	/** The column definitions keyed by name and alias */
	declare columns: Record<ColName, JMNormalizedColumnDef<DBItem>>
	/** The columns that need to be taken from the SQL table */
	declare getCols: JMNormalizedColumnDef<DBItem>[]

	declare _selectColNames: ColName[]
	declare _selectColAliases: string[]
	declare _selectColsSql: string

	declare _set: ReturnType<typeof this._makeSetFn>

	constructor(config: RealConfig) {
		verifyOptions(config)
		const {
			db,
			name,
			migrations,
			migrationOptions,
			columns,
			ItemClass,
			idCol = 'id',
			keepRowId = true,
		} = config

		this.db = db!
		this.name = name as Name
		this.quoted = sql.quoteId(name)
		this.idCol = idCol as IDCol
		this.idColQ = sql.quoteId(idCol)
		this.Item = ItemClass

		const idColDefOrFn: JMColumnDefOrFn = (columns && columns[idCol]) || {}
		const jsonColDefOrFn: JMColumnDefOrFn = (columns && columns.json) || {}
		const idColDef =
			typeof idColDefOrFn === 'function'
				? (idColDefOrFn as JMColumnFn)({columnName: idCol})
				: idColDefOrFn
		const jsonColDef =
			typeof jsonColDefOrFn === 'function'
				? (jsonColDefOrFn as JMColumnFn)({columnName: 'json'})
				: jsonColDefOrFn

		const allColumns = {
			...columns,
			[idCol]: {
				type: idColDef.type || 'TEXT',
				alias: idColDef.alias || '_i',
				value: makeIdValue(idCol, idColDef),
				index: 'ALL',
				autoIncrement: idColDef.autoIncrement,
				unique: true,
				get: true,
			},
			json: {
				alias: jsonColDef.alias || '_j',
				// return null if empty, makes parseRow faster
				parse: jsonColDef.parse || parseJson,
				stringify: jsonColDef.stringify || stringifyJsonObject,
				type: 'JSON',
				alwaysObject: true,
				path: '',
				get: true,
			},
		}
		// Note the order above, id and json should be calculated last
		this.columnArr = []
		this.columns = {} as Record<ColName, JMNormalizedColumnDef<DBItem>>
		let i = 0
		for (const [colName, colDef] of Object.entries(allColumns) as [
			ColName,
			JMColumnDefOrFn,
		][]) {
			let col
			if (typeof colDef === 'function') {
				col = colDef({columnName: colName})
				verifyColumn(colName, col)
			} else {
				col = {...colDef}
			}
			col.alias = col.alias || `_${i++}`
			if (this.columns[col.alias])
				throw new TypeError(
					`Cannot alias ${col.name} over existing name ${col.alias}`
				)

			// Step 1 of normalization
			col = normalizeColumn(col, colName)
			this.columns[colName] = col
			this.columns[col.alias as ColName] = col
			this.columnArr.push(col)
		}
		assignJsonParents(this.columnArr)
		// Step 2 of normalization
		for (const col of this.columnArr) prepareSqlCol(col, this.name)
		this.getCols = this.columnArr.filter(c => c.get).sort(byPathLength)

		this.db.registerMigrations(
			name,
			makeMigrations({
				name: this.name,
				columns: this.columns as any,
				idCol,
				keepRowId,
				migrations,
				migrationOptions,
			})
		)

		this._set = this._makeSetFn()
		// The columns we should normally fetch - json + get columns

		const selectCols = this.columnArr.filter(c => c.get || c.name === 'json')
		this._selectColNames = selectCols.map(c => c.name) as ColName[]
		this._selectColAliases = selectCols.map(c => c.alias)
		this._selectColsSql = selectCols.map(c => c.select).join(',')
	}

	parseRow = (
		row: SQLiteRow,
		options?: {cols?: ColName[]}
	): typeof options extends {cols: (infer C extends keyof DBItem)[]}
		? Pick<DBItem, C>
		: DBItem => {
		const mapCols: JMNormalizedColumnDef<DBItem>[] =
			options && options.cols
				? options.cols.map(n => this.columns[n])
				: this.getCols
		const out = (this.Item ? new this.Item() : {}) as DBItem
		for (const k of mapCols) {
			let val
			if (dbg.enabled) {
				try {
					val = k.parse ? k.parse(row[k.alias]) : row[k.alias]
				} catch (err) {
					dbg(
						`!!! ${this.name}.${k.name}:  parse failed for value ${String(
							row[k.alias]
						).slice(0, 20)}`
					)
					throw err
				}
			} else {
				val = k.parse ? k.parse(row[k.alias]) : row[k.alias]
			}
			if (val != null) {
				if (k.path) {
					if (k.real) {
						const prevVal = get(out, k.path)
						// Prevent added columns from overwriting existing data
						if (typeof prevVal !== 'undefined') continue
					}
					set(out, k.path, val)
				} else Object.assign(out, val) // json col
			}
		}
		return out
	}

	declare _insertSql: Statement
	declare _updateSql: Statement

	_makeSetFn() {
		const {db, Item, columnArr, quoted, idCol, name} = this
		const valueCols = columnArr
			.filter(c => c.value)
			.sort(byPathLength) as ForSure<JMNormalizedColumnDef<DBItem>, 'value'>[]
		const realCols = columnArr
			.filter(c => c.real)
			.sort(byPathLengthDesc)
			.map((c, i) => ({
				...c,
				i,
				valueI: c.value && valueCols.indexOf(c as (typeof valueCols)[0]),
			})) as ForSure<
			// valueI is actualy undefined if no value but this is easier
			JMNormalizedColumnDef<DBItem> & {i: number; valueI: number},
			'real'
		>[]
		// This doesn't include sql expressions, you need to .get() for those
		const setCols = [...realCols].filter(c => c.get).reverse()
		/** The paths that calculate their value on */
		const calculators = new Set<string>()
		for (const col of valueCols) {
			for (let i = 1; i < col.parts.length; i++)
				calculators.add(col.parts.slice(0, i).join('.'))
		}
		for (const col of realCols) {
			for (let i = 1; i < col.parts.length; i++)
				if (col.get) calculators.add(col.parts.slice(0, i).join('.'))
		}
		const calcPaths = [...calculators].sort(
			(a, b) => (a ? a.split('.').length : 0) - (b ? b.split('.').length : 0)
		)
		const cloneObj = calcPaths.length
			? obj => {
					obj = {...obj}
					for (const path of calcPaths) {
						set(obj, path, {...get(obj, path)})
					}
					return obj
			  }
			: obj => ({...obj})
		const colSqls = realCols.map(col => col.quoted)
		const setSql = `INTO ${quoted}(${colSqls.join(',')}) VALUES(${colSqls
			.map(() => '?')
			.join(',')})`
		return async (o: InputItem, insertOnly?: boolean, noReturn?: boolean) => {
			if (this._insertSql?.db !== db) {
				this._insertSql = db.prepare(`INSERT ${setSql}`, `ins ${name}`)
				const updateSql = colSqls
					.map((col, i) => `${col} = ?${i + 1}`)
					.join(', ')
				this._updateSql = db.prepare(
					`INSERT ${setSql} ON CONFLICT(${idCol}) DO UPDATE SET ${updateSql}`,
					`set ${name}`
				)
			}
			const {_insertSql, _updateSql} = this
			const obj = cloneObj(o)
			const results = await Promise.all(
				valueCols.map(col =>
					// value functions must be able to use other db during migrations, so call with our this
					col.value.call(this, obj)
				)
			)
			for (const [i, r] of results.entries()) {
				const col = valueCols[i]
				// realCol values can be different from obj values
				if (col.path && (!col.real || col.get)) set(obj, col.path, r)
			}
			const colVals = realCols.map(col => {
				let v
				if (col.path) {
					v = col.value ? results[col.valueI] : get(obj, col.path)
					if (col.get) set(obj, col.path, undefined)
				} else {
					v = obj
				}
				return col.stringify ? col.stringify(v) : v
			}) as SQLiteParam[]

			// The json field is part of the colVals
			const P = insertOnly ? _insertSql.run(colVals) : _updateSql.run(colVals)
			return noReturn
				? P
				: P.then(result => {
						// Return what get(id) would return
						const newObj = (Item ? new Item() : {}) as DBItem
						for (const col of setCols) {
							const val = colVals[col.i]
							const v = col.parse
								? col.parse(typeof val === 'boolean' ? Number(val) : val)
								: val
							if (col.path === '') Object.assign(newObj, v)
							else set(newObj, col.path, v)
						}
						if (newObj[this.idCol] == null) {
							// This can only happen for integer ids, so we use the last inserted rowid
							newObj[this.idCol] = result.lastID as any
						}
						return newObj
				  })
		}
	}

	_colSql(colName) {
		return this.columns[colName] ? this.columns[colName].sql : colName
	}

	// Converts a row or array of rows to objects
	toObj = (thing: SQLiteRow | SQLiteRow[], options?: {cols?: ColName[]}) => {
		if (!thing) {
			return
		}
		if (Array.isArray(thing)) {
			return thing.map(r => this.parseRow(r, options))
		}
		return this.parseRow(thing, options)
	}

	/**
	 * Parses query options into query parts. Override this function to implement
	 * search behaviors.
	 */
	makeSelect(options: JMSearchOptions<ColName>) {
		if (process.env.NODE_ENV !== 'production') {
			const extras = Object.keys(options).filter(
				k =>
					![
						'attrs',
						'cols',
						'cursor',
						'join',
						'joinVals',
						'limit',
						'noCursor',
						'noTotal',
						'offset',
						'sort',
						'where',
					].includes(k)
			)
			if (extras.length) {
				console.warn('Got unknown options for makeSelect:', extras, options) // eslint-disable-line no-console
			}
		}
		const {
			cols: origCols,
			attrs,
			join,
			joinVals,
			where: extraWhere,
			limit,
			offset,
			cursor,
			noCursor,
			noTotal,
		} = options
		let {sort} = options

		let cols = origCols || this._selectColNames
		let cursorColAliases, cursorQ, cursorArgs
		const makeCursor = limit && !noCursor

		const {cursorVals, invert} = decodeCursor(cursor)

		if (cursor || makeCursor) {
			// We need a tiebreaker sort for cursors
			sort =
				sort && sort[this.idCol as ColName]
					? sort
					: {...sort, [this.idCol]: 100_000}
		}

		// Columns to sort by, in priority order
		const sortNames =
			sort &&
			(Object.keys(sort)
				.filter(k => sort![k])
				.sort((a, b) => Math.abs(sort![a]) - Math.abs(sort![b])) as
				| ColName[]
				| undefined)

		if (makeCursor || cursor) {
			let copiedCols = false
			// We need the sort columns in the output to get the cursor value
			for (const colName of sortNames!) {
				if (!cols.includes(colName)) {
					if (!copiedCols) {
						cols = [...cols]
						copiedCols = true
					}
					cols.push(colName)
				}
			}
			cursorColAliases = sortNames!.map(c =>
				this.columns[c] ? this.columns[c].alias : c
			)
		}

		if (cursor) {
			// Create the sort condition for keyset pagination:
			// Given cursor (v0, v1, v2) for columns (a, b, c), we get the
			// next matches with:
			// a >= v0 && (a != v0 || (b >= v1 && (b != v1 || (c > v2))))
			// To match previous values, reverse comparisons:
			// a <= v0 && (a != v0 || (b <= v1 && (b != v1 || (c < v2))))
			// To page forward, we need smallest next matches; to page
			// backwards, we need largest previous matches.
			// Match direction and order follow sort direction and order.

			// invert inverts sort direction
			// @ts-expect-error 2447
			const getDir = i => ((sort![sortNames![i]]! < 0) ^ invert ? '<' : '>')
			const len = cursorVals!.length - 1
			cursorQ = `${cursorColAliases[len]}${getDir(len)}?`
			cursorArgs = [cursorVals![len]] // ID added at first
			for (let i = len - 1; i >= 0; i--) {
				cursorQ =
					`(${cursorColAliases[i]}${getDir(i)}=?` +
					` AND (${cursorColAliases[i]}!=? OR ${cursorQ}))`
				const val = cursorVals![i]
				cursorArgs.unshift(val, val)
			}
		}

		const colsSql =
			cols === this._selectColNames
				? this._selectColsSql
				: cols
						.map(c => (this.columns[c] ? this.columns[c].select : c))
						.join(',')
		const selectQ = `SELECT ${colsSql} FROM ${this.quoted} tbl`

		const vals: SQLiteValue[] = []
		const conds: string[] = []
		if (extraWhere) {
			for (const w of Object.keys(extraWhere)) {
				const val = extraWhere[w]
				if (val) {
					if (!Array.isArray(val)) {
						throw new TypeError(
							`Error: Got where without array of args for makeSelect: ${w}, val: ${val}`
						)
					}
					conds.push(w)
					vals.push(...(extraWhere[w] as SQLiteValue[]))
				}
			}
		}
		if (attrs) {
			for (const a of Object.keys(attrs)) {
				let val = attrs[a]
				if (val == null) continue
				const col = this.columns[a]
				if (!col) {
					throw new Error(`Unknown column ${a}`)
				}
				const origVal = val
				const {where, whereVal} = col
				let valid = true
				if (whereVal) {
					val = whereVal(val)
					if (Array.isArray(val)) {
						vals.push(...val)
					} else {
						if (val)
							throw new Error(`whereVal for ${a} should return array or falsy`)
						valid = false
					}
				} else {
					vals.push(val)
				}
				if (valid) {
					// Note that we don't attempt to use aliases, because of sharing the whereQ with
					// the total calculation, and the query optimizer recognizes the common expressions
					conds.push(typeof where === 'function' ? where(val, origVal) : where)
				}
			}
		}

		const orderQ =
			sortNames?.length &&
			`ORDER BY ${sortNames
				.map(k => {
					const col = this.columns[k]
					// If we selected we can use the alias
					const colSql = col
						? cols.includes(col.name as ColName)
							? col.alias
							: col.sql
						: k
					return `${colSql}${
						// @ts-expect-error 2447
						(sort[k]! < 0) ^ invert ? ` DESC` : ``
					}`
				})
				.join(',')}`
		/* eslint-enable @typescript-eslint/no-non-null-assertion */

		// note: if preparing, this can be replaced with LIMIT(?,?)
		// First is offset (can be 0) and second is limit (-1 for no limit)
		const limitQ = limit && `LIMIT ${Number(limit) || 10}`
		const offsetQ = offset && `OFFSET ${Number(offset) || 0}`

		if (join && joinVals && joinVals.length) {
			vals.unshift(...joinVals)
		}

		const calcTotal = !(noTotal || noCursor)
		const allConds = cursorQ ? [...conds, cursorQ] : conds
		const qVals = cursorArgs ? [...(vals || []), ...cursorArgs] : vals
		const allWhereQ =
			allConds.length && `WHERE${allConds.map(c => `(${c})`).join('AND')}`
		const whereQ =
			calcTotal &&
			conds.length &&
			`WHERE${conds.map(c => `(${c})`).join('AND')}`

		const q = [selectQ, join, allWhereQ, orderQ, limitQ, offsetQ]
			.filter(Boolean)
			.join(' ')
		const totalQ =
			calcTotal &&
			[`SELECT COUNT(*) as t from (`, selectQ, join, whereQ, ')']
				.filter(Boolean)
				.join(' ')
		return [q, qVals, cursorColAliases, totalQ, vals, invert]
	}

	/**
	 * Search the first matching object.
	 *
	 * @param attrs      - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result or undefined if no match.
	 */
	async searchOne(
		attrs: SearchAttrs | undefined | null,
		options?: SearchOptions
	): Promise<DBItem | undefined> {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			limit: 1,
			noCursor: true,
		})
		const row = await this.db.get(q, vals)
		return row && this.parseRow(row)
	}

	/**
	 * Search all matching objects with pagination.
	 *
	 * @param attrs      - simple value attributes.
	 * @param [options]  - search options.
	 * @returns If itemsOnly is true, returns an array of items. Otherwise,
	 *          returns an object with items, total count and cursor. If there
	 *          are no more items, cursor will be undefined.
	 */
	async search(
		attrs: SearchAttrs | undefined | null,
		options: SearchOptions & {itemsOnly: true}
	): Promise<DBItem[]>
	async search(
		attrs: SearchAttrs | undefined | null,
		options?: SearchOptions & {itemsOnly?: false}
	): Promise<SearchResults<DBItem>>
	async search(
		attrs: SearchAttrs | undefined | null,
		{itemsOnly, ...options} = {} as SearchOptions & {itemsOnly?: boolean}
	): Promise<DBItem[] | SearchResults<DBItem>> {
		const [q, vals, cursorKeys, totalQ, totalVals, invert] = this.makeSelect({
			attrs,
			noCursor: itemsOnly,
			...options,
		})
		const [rows, totalO] = await Promise.all([
			this.db.all(q, vals),
			totalQ && this.db.get(totalQ, totalVals),
		])
		// When using prevCursor, the results are reversed
		if (invert) rows.reverse()
		const items = this.toObj(rows, options) as DBItem[]
		if (itemsOnly) return items
		let cursor, prevCursor
		if (rows.length && options?.limit && !options.noCursor) {
			cursor =
				(rows.length === options.limit &&
					(!totalQ || totalO?.t > options.limit) &&
					encodeCursor(rows.at(-1)!, cursorKeys)) ||
				undefined
			prevCursor = encodeCursor(rows[0], cursorKeys, true)
		}
		return {items, cursor, prevCursor, total: totalO?.t}
	}

	/** Same as search but returns items only */
	searchAll(attrs: SearchAttrs, options: SearchOptions) {
		return this.search(attrs, {...options, itemsOnly: true})
	}

	declare _existsSql: Statement

	/**
	 * Check for existence of objects. Returns `true` if the search would yield
	 * results.
	 *
	 * @returns Whether the search results exist.
	 */
	async exists<IdObj extends IDType | SearchAttrs>(
		idOrAttrs: IdObj,
		options?: IdObj extends IDType ? never : SearchOptions
	): Promise<boolean> {
		if (idOrAttrs && typeof idOrAttrs !== 'object') {
			if (this._existsSql?.db !== this.db) {
				const where = this.columns[this.idCol as ColName].sql
				this._existsSql = this.db.prepare(
					`SELECT 1 FROM ${this.quoted} tbl WHERE ${where} = ?`,
					`existsId ${this.name}`
				)
			}
			return this._existsSql.get([idOrAttrs]).then(row => !!row)
		}
		const [q, vals] = this.makeSelect({
			attrs: idOrAttrs,
			...options,
			sort: undefined,
			limit: 1,
			offset: undefined,
			noCursor: true,
			// Slight hack, don't ask for any row data
			cols: ['1' as ColName],
		})
		const row = await this.db.get(q, vals)
		return !!row
	}

	/**
	 * Count of search results.
	 *
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - Search options.
	 * @returns - the count.
	 */
	async count(attrs?: SearchAttrs, options?: SearchOptions): Promise<number> {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			// When counting from cursor, sort is needed
			// otherwise, sort doesn't help
			sort: options?.cursor ? options.sort : undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			// Hack: You can actually pass select expressions
			cols: ['COUNT(*) AS c' as ColName],
		})
		const row = await this.db.get(q, vals)
		return row!.c as number
	}

	/**
	 * Numeric Aggregate Operation.
	 *
	 * @param op         - the SQL function, e.g. MAX.
	 * @param colName    - column to aggregate.
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result.
	 */
	async numAggOp(
		op: 'AVG' | 'MAX' | 'MIN' | 'SUM' | 'TOTAL',
		colName: ColName,
		attrs?: SearchAttrs | null,
		options?: SearchOptions
	): Promise<number> {
		const col = this.columns[colName]
		const colSql = (col && col.sql) || colName
		const o = {
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			noTotal: true,
			cols: [`${op}(CAST(${colSql} AS NUMERIC)) AS val`],
		} as SearchOptions
		if (col && col.ignoreNull) {
			// Make sure we can use the index
			o.where = {...o.where, [`${colSql} IS NOT NULL`]: []}
		}
		const [q, vals] = this.makeSelect(o)
		const row = await this.db.get(q, vals)
		return row!.val as number
	}

	/**
	 * Maximum value.
	 *
	 * @param colName    - column to aggregate.
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result.
	 */
	max(colName: ColName, attrs?: SearchAttrs | null, options?: SearchOptions) {
		return this.numAggOp('MAX', colName, attrs, options)
	}

	/**
	 * Minimum value.
	 *
	 * @param colName    - column to aggregate.
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result.
	 */
	min(colName: ColName, attrs?: SearchAttrs | null, options?: SearchOptions) {
		return this.numAggOp('MIN', colName, attrs, options)
	}

	/**
	 * Sum values.
	 *
	 * @param colName    - column to aggregate.
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result.
	 */
	sum(colName: ColName, attrs?: SearchAttrs | null, options?: SearchOptions) {
		return this.numAggOp('SUM', colName, attrs, options)
	}

	/**
	 * Average value.
	 *
	 * @param colName    - column to aggregate.
	 * @param [attrs]    - simple value attributes.
	 * @param [options]  - search options.
	 * @returns The result.
	 */
	avg(colName: ColName, attrs?: SearchAttrs | null, options?: SearchOptions) {
		return this.numAggOp('AVG', colName, attrs, options)
	}

	declare _allSql: Statement<ItemType>

	/**
	 * Get all objects.
	 *
	 * @returns The table contents.
	 */
	async all(): Promise<DBItem[]> {
		if (this._allSql?.db !== this.db)
			this._allSql = this.db.prepare(
				`SELECT ${this._selectColsSql} FROM ${this.quoted} tbl`,
				`all ${this.name}`
			) as any
		const rows = await this._allSql.all()
		return this.toObj(rows) as DBItem[]
	}

	/**
	 * Get an object by a unique value, like its ID.
	 *
	 * @param id         - the value for the column.
	 * @param [colName]  - the columnname, defaults to the ID column.
	 * @returns The object if it exists.
	 */
	async get(
		id: SQLiteValue,
		colName = this.idCol as ColName
	): Promise<DBItem | undefined> {
		if (id == null) {
			throw new Error(`No id given for "${this.name}.${colName}"`)
		}
		const col = this.columns[colName]
		if (!col)
			throw new Error(`Unknown column "${colName}" given for "${this.name}"`)
		if (col._getSql?.db !== this.db) {
			col._getSql = this.db.prepare(
				`SELECT ${this._selectColsSql} FROM ${this.quoted} tbl WHERE ${col.sql} = ?`,
				`get ${this.name}.${colName}`
			) as any
		}
		const row = await col._getSql.get([id])
		return row && this.parseRow(row)
	}

	/**
	 * Get several objects by their unique value, like their ID.
	 *
	 * @param ids        - the values for the column.
	 * @param [colName]  - the columnname, defaults to the ID column.
	 * @returns - the objects, or undefined where they don't exist, in order of
	 *          their requested ID.
	 */
	async getAll(
		ids: readonly SQLiteValue[],
		colName = this.idCol as ColName
	): Promise<(DBItem | undefined)[]> {
		const {path} = this.columns[colName]
		let {_getAllSql} = this.columns[colName]
		if (_getAllSql?.db !== this.db) {
			const {sql: where, real, get: isSelected} = this.columns[colName]
			if (real && !isSelected)
				throw new Error(
					`JsonModel: Cannot getAll on get:false column ${colName}`
				)
			_getAllSql = this.db.prepare(
				`SELECT ${this._selectColsSql} FROM ${this.quoted} tbl WHERE ${where} IN (SELECT value FROM json_each(?))`,
				`get ${this.name}.${colName}`
			) as any
			this.columns[colName]._getAllSql = _getAllSql
		}
		if (!ids?.length) return []
		if (ids.length === 1) return [await this.get(ids[0], colName)]
		const rows = await _getAllSql.all([JSON.stringify(ids)])
		const objs = this.toObj(rows) as DBItem[]
		return ids.map(id => objs.find(o => get(o, path) === id))
	}

	_ensureLoader(
		cache: JMCache<DBItem>,
		colName: ColName
	): Loader<SQLiteValue, DBItem> {
		if (!cache) throw new Error(`cache is required`)
		const key = `_DL_${this.name}_${colName}`
		if (!cache[key]) {
			// batchSize: max is SQLITE_MAX_VARIABLE_NUMBER, default 999. Lower => less latency
			cache[key] = new DataLoader(ids => this.getAll(ids, colName), {
				maxBatchSize: 100,
			})
		}
		return cache[key]
	}

	/**
	 * Get an object by a unique value, like its ID, using a cache.
	 * This also coalesces multiple calls in the same tick into a single query,
	 * courtesy of DataLoader.
	 *
	 * @returns - the object if it exists. It will be cached.
	 */
	getCached(
		cache: JMCache<DBItem>,
		id: SQLiteValue,
		colName = this.idCol as ColName
	) {
		if (!cache) return this.get(id, colName)
		return this._ensureLoader(cache, colName).load(id)
	}

	/**
	 * Lets you clear all the cache or just a key. Useful for when you change only
	 * some items.
	 *
	 * @param cache      - the lookup cache. It is managed with DataLoader.
	 * @param [id]       - the value for the column.
	 * @param [colName]  - the columnname, defaults to the ID column.
	 * @returns The actual cache, you can call `.prime(key, value)` on it to
	 *          insert a value.
	 */
	clearCache(
		cache: JMCache<DBItem>,
		id: SQLiteValue,
		colName = this.idCol as ColName
	): Loader<SQLiteValue, DBItem> {
		const loader = this._ensureLoader(cache, colName)
		if (id) return loader.clear(id)
		return loader.clearAll()
	}

	/**
	 * Iterate through search results. Calls `fn` on every result.
	 * The iteration uses a cursored search, so changes to the model during the
	 * iteration can influence the iteration.
	 *
	 * When a callback errors, no new batches are started and the last error will
	 * be thrown.
	 *
	 * @returns Promise for search completion.
	 */
	async each(
		attrs: SearchAttrs,
		options: JMEachOptions<SearchOptions>,
		fn: JMItemCallback<DBItem>
	): Promise<void>
	async each(attrs: SearchAttrs, fn: JMItemCallback<DBItem>): Promise<void>
	async each(fn: JMItemCallback<DBItem>): Promise<void>
	async each(
		attrsOrFn: SearchAttrs | JMItemCallback<DBItem>,
		optionsOrFn?: JMEachOptions<SearchOptions> | JMItemCallback<DBItem>,
		fn?: JMItemCallback<DBItem>
	): Promise<void> {
		if (!fn) {
			if (optionsOrFn) {
				if (typeof optionsOrFn === 'function') {
					fn = optionsOrFn
					optionsOrFn = undefined
				} else if (optionsOrFn.fn) {
					fn = optionsOrFn.fn
					delete optionsOrFn.fn
				}
			} else if (typeof attrsOrFn === 'function') {
				fn = attrsOrFn
				attrsOrFn = undefined as any
			}
			if (!fn) throw new Error('each requires function')
		}
		if (!optionsOrFn) optionsOrFn = {} as JMEachOptions<SearchOptions>
		const {
			concurrent = 5,
			batchSize = 50,
			// In the next major release, limit will apply to the total amount, not the batch size
			limit = batchSize,
			// We need the cursor
			noCursor: _,
			...rest
		} = optionsOrFn as JMEachOptions<SearchOptions>
		rest.noTotal = true
		let cursor: JMCursor | undefined
		let i = 0
		do {
			const result = await this.search(
				attrsOrFn as SearchAttrs,
				{...rest, limit, cursor} as SearchOptions
			)
			cursor = result.cursor
			await settleAll(result.items, async v => fn!(v, i++), concurrent)
		} while (cursor)
	}

	// --- Mutator methods below ---

	/**
	 * Insert or replace the given object into the database.
	 *
	 * Note: All subclasses must use .set() to store values.
	 *
	 * @param obj           - the object to store. If there is no `id` value (or
	 *                      whatever the `id` column is named), one is assigned
	 *                      automatically.
	 * @param [insertOnly]  - don't allow replacing existing objects.
	 * @param [noReturn]    - do not return the stored object; an optimization.
	 *                      It will return the sqlite changes summary instead
	 *                      (if the subclass supports it).
	 * @returns - if `noReturn` is falsy, the stored object is returned.
	 */
	set<NoReturn extends boolean>(
		obj: InputItem,
		insertOnly?: boolean,
		noReturn?: NoReturn
	): Promise<IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>> {
		// we cannot store `set` directly on the instance because it would override subclass `set` functions
		return this._set(obj, insertOnly, noReturn) as any
	}

	/**
	 * Update or upsert an object, shallowly merging the changes.
	 * Setting a key to `null` or `undefined` will remove it from the object.
	 * This does not use a transaction so is open to race conditions if you don't
	 * run it in a transaction.
	 *
	 * @param changes     The changes to store, including the id field.
	 * @param [upsert]    Insert the object if it doesn't exist.
	 * @param [noReturn]  Do not return the stored object, an optimization.
	 * @returns - if `noReturn` is falsy, the stored object is returned.
	 */
	async updateNoTrans<NoReturn extends boolean>(
		changes: InputItem,
		upsert?: boolean,
		noReturn?: NoReturn
	): Promise<IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>> {
		if (!changes) throw new Error('update() called without object')
		const id = changes[this.idCol]
		if (id == null) {
			if (!upsert) throw new Error('Can only update object with id')
			return this.set(changes, false, noReturn)
		}
		let prev: DBItem | InputItem | undefined = await this.get(id)
		if (!upsert && !prev) throw new Error(`No object with id ${id} exists yet`)
		if (prev)
			for (const [key, value] of Object.entries(changes)) {
				if (value == null) delete prev[key]
				else prev[key] = value
			}
		else prev = changes
		return this.set(prev as InputItem, false, noReturn)
	}

	/**
	 * Update or upsert an object, shallowly merging the changes.
	 * Setting a key to `null` or `undefined` will remove it from the object.
	 * This uses a transaction if one is not active.
	 *
	 * @param obj         The changes to store, including the id field.
	 * @param [upsert]    Insert the object if it doesn't exist.
	 * @param [noReturn]  Do not return the stored object, an optimization.
	 * @returns - if `noReturn` is falsy, the stored object is returned.
	 */
	update<NoReturn extends boolean>(
		changes: InputItem,
		upsert?: boolean,
		noReturn?: NoReturn
	): Promise<IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>> {
		// Update needs to read the object to apply the changes, so it needs a transaction
		if (this.db.inTransaction)
			return this.updateNoTrans(changes, upsert, noReturn)
		return this.db.withTransaction(() =>
			this.updateNoTrans(changes, upsert, noReturn)
		)
	}

	declare _deleteSql: Statement<undefined, [IDType]>

	/**
	 * Remove an object. If the object doesn't exist, this doesn't do anything.
	 *
	 * @param idOrObj  The id or the object itself.
	 * @returns A promise for the deletion.
	 */
	remove(idOrObj: IDCol | DBItem): Promise<SQLiteChangesMeta | undefined> {
		const id = (
			typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		) as IDType
		if (this._deleteSql?.db !== this.db)
			this._deleteSql = this.db.prepare(
				`DELETE FROM ${this.quoted} WHERE ${this.idColQ} = ?`,
				`del ${this.name}`
			) as any
		return this._deleteSql.run([id])
	}

	/** @deprecated use .remove() */
	delete(idOrObj: IDCol | DBItem) {
		if (DEV) deprecated('deleteMethod', 'use .remove() instead of .delete()')
		return this.remove(idOrObj)
	}

	/**
	 * "Rename" an object.
	 *
	 * @param oldId  The current ID. If it doesn't exist this will throw.
	 * @param newId  The new ID. If this ID is already in use this will throw.
	 * @returns A promise for the rename.
	 */
	async changeId(oldId, newId) {
		if (newId == null) throw new TypeError('newId must be a valid id')
		let {_changeIdSql} = this.columns[this.idCol as ColName]
		if (_changeIdSql?.db !== this.db) {
			const {quoted} = this.columns[this.idCol as ColName]
			_changeIdSql = this.db.prepare(
				`UPDATE ${this.quoted} SET ${quoted} = ? WHERE ${quoted} = ?`,
				`mv ${this.name}`
			) as any
			this.columns[this.idCol as ColName]._changeIdSql = _changeIdSql
		}
		const {changes} = await _changeIdSql.run([newId, oldId])
		if (changes !== 1) throw new Error(`row with id ${oldId} not found`)
		return undefined
	}
}

export default JsonModel
