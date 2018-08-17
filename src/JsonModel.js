import debug from 'debug'
import PropTypes from 'prop-types'
import uuid from 'uuid'
import jsurl from 'jsurl'
import {sql, valToSql} from './DB'
import {uniqueSlugId} from './slugify'
import DataLoader from 'dataloader'
import {get, set} from 'lodash'

const dbg = debug('stratokit/JSON')
const DEV = process.env.NODE_ENV !== 'production'
let deprecated, unknown
if (DEV) {
	const warned = {}
	const warner = type => (tag, msg) => {
		if (warned[tag]) return
		warned[tag] = true
		// eslint-disable-next-line no-console
		console.error(new Error(`!!! ${type} ${msg}`))
	}
	deprecated = warner('DEPRECATED')
	unknown = warner('UNKNOWN')
}

const jmPropTypes =
	process.env.NODE_ENV === 'production'
		? null
		: {
				options: PropTypes.exact({
					db: PropTypes.object.isRequired,
					name: PropTypes.string.isRequired,
					migrations: PropTypes.objectOf(
						PropTypes.oneOfType([
							PropTypes.oneOf([false, undefined, null]),
							PropTypes.func,
							PropTypes.exact({up: PropTypes.func, down: PropTypes.func}),
						])
					),
					migrationOptions: PropTypes.object,
					columns: PropTypes.objectOf(
						PropTypes.exact({
							// === sql column ===
							real: PropTypes.bool, // true -> a real table column is made
							// column type if real column
							type: PropTypes.oneOf([
								'TEXT',
								'NUMERIC',
								'INTEGER',
								'REAL',
								'BLOB',
								'JSON',
							]),
							path: PropTypes.string, // path to value in object
							autoIncrement: PropTypes.bool, // autoincrementing key
							alias: PropTypes.string, // column alias
							get: PropTypes.bool, // include column in query results, strip data from json
							parse: PropTypes.func, // returns JS value given column data
							stringify: PropTypes.func, // returns column value given object data

							// === value related ===
							slugValue: PropTypes.func, // returns seed for uniqueSlugId
							sql: PropTypes.string, // sql expression for column
							value: PropTypes.func, // value to store
							default: PropTypes.any, // js expression, default value
							required: PropTypes.bool, // throw if no value

							// === index ===
							// create index for this column
							index: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
							ignoreNull: PropTypes.bool, // ignore null in index
							unique: PropTypes.bool, // create index with unique contstraint

							// === queries ===
							where: PropTypes.oneOfType([PropTypes.string, PropTypes.func]), // returns WHERE condition given value
							whereVal: PropTypes.func, // returns values array for condition

							// === query helpers ===
							in: PropTypes.bool, // column matches any of given array
							inAll: PropTypes.bool, // column matches all of given array
							isAnyOfArray: PropTypes.bool, // in:true + isArray: true
							isArray: PropTypes.bool, // json path is an array value
							textSearch: PropTypes.bool, // search for substring of column
						})
					),
					ItemClass: PropTypes.func,
					idCol: PropTypes.string,
					dispatch: PropTypes.any, // passed by ESDB but not used
				}),
		  }

const verifyOptions = options => {
	if (process.env.NODE_ENV !== 'production') {
		/* eslint-disable no-console */
		const prevError = console.error
		console.error = message => {
			console.error = prevError
			throw new Error(message)
		}
		PropTypes.checkPropTypes(jmPropTypes, {options}, 'options', 'JsonModel')
		console.error = prevError
		/* eslint-enable no-console */
	}
}

const byPathLength = (a, b) => a.parts.length - b.parts.length
const byPathLengthDesc = (a, b) => b.parts.length - a.parts.length

// eslint-disable-next-line complexity
const normalizeColumn = (col, name) => {
	col.name = name
	col.quoted = sql.quoteId(name)
	if (col.type) col.real = true
	else if (col.real) col.type = 'BLOB'
	if (col.get == null) col.get = !!col.real

	if (!col.path && name !== 'json') col.path = name

	col.parts = col.path === '' ? [] : col.path.split('.')

	if (col.index === 'ALL') col.ignoreNull = false
	if (col.index === 'SPARSE') col.ignoreNull = true
	if (col.unique) {
		if (!col.index) throw new TypeError(`${name}: unique requires index`)
	} else if (col.ignoreNull == null) {
		col.ignoreNull = true
	}

	if (col.autoIncrement && col.type !== 'INTEGER')
		throw new TypeError(`${name}: autoIncrement is only for type INTEGER`)

	if (col.slugValue) {
		if (col.value)
			throw new TypeError(`${name}: slugValue and value can't both be defined`)
		if (!col.index) throw new TypeError(`${name}: slugValue requires index`)
		col.value = async function(o) {
			if (o[name] != null) return o[name]
			return uniqueSlugId(this, await col.slugValue(o), name, o[this.idCol])
		}
	}

	if (col.default != null) {
		col.ignoreNull = false
		const prev = col.value
		if (prev) {
			col.value = async function(o) {
				const r = await prev.call(this, o)
				return r == null ? col.default : r
			}
		} else if (col.sql) {
			col.sql = `ifNull(${col.sql},${valToSql(col.default)})`
		} else {
			col.value = o => {
				const v = get(o, col.path)
				return v == null ? col.default : v
			}
		}
	}

	if (col.required) {
		col.ignoreNull = false
		const prev = col.value
		if (prev) {
			col.value = async function(o) {
				const r = await prev.call(this, o)
				if (r == null) throw new Error(`${name}: value is required`)
				return r
			}
		} else {
			col.value = o => {
				const v = get(o, col.path)
				if (v == null) throw new Error(`${name}: value is required`)
				return v
			}
		}
	}

	if (col.type === 'JSON') {
		if (col.stringify === undefined) col.stringify = JSON.stringify
		if (col.parse === undefined)
			col.parse = v => (v == null ? v : JSON.parse(v))
	}

	if (!col.real && col.stringify)
		throw new Error(`${name}: stringify only applies to real columns`)
	if (!col.get && col.parse)
		throw new Error(`${name}: parse only applies to get:true columns`)
}

const assignJsonParents = columnArr => {
	const parents = columnArr
		.filter(c => c.type === 'JSON' && c.get)
		.sort(byPathLengthDesc)
	for (const col of columnArr)
		if (!col.real) {
			// Will always match, json column has path:''
			const parent = parents.find(
				p => !p.path || col.path.startsWith(p.path + '.')
			)
			col.jsonCol = parent.name
			col.jsonPath = parent.path
				? col.path.slice(parent.path.length + 1)
				: col.path
		}
}

// eslint-disable-next-line complexity
const prepareSqlCol = col => {
	if (!col.sql) {
		col.sql = col.type
			? `tbl.${col.quoted}`
			: `json_extract(tbl.${sql.quoteId(col.jsonCol)},'$.${col.jsonPath}')`
	}
	if (col.isAnyOfArray) {
		col.isArray = true
		col.in = true
	}
	if (col.isArray) {
		if (col.where || col.whereVal)
			throw new TypeError(`${name}: cannot mix isArray and where/whereVal`)
		if (col.textSearch)
			throw new TypeError(`${name}: Only one of isArray/textSearch allowed`)
		const jsonExpr = `SELECT 1 FROM json_each(${
			col.type
				? `tbl.${col.quoted}`
				: `tbl.${sql.quoteId(col.jsonCol)},'$.${col.jsonPath}'`
		}) j WHERE j.value`
		if (col.in) {
			col.where = args =>
				`EXISTS(${jsonExpr} IN (${args.map(() => '?').join(',')}))`
			col.whereVal = args => args && args.length && args
		} else if (col.inAll) {
			col.where = args =>
				`? IN (SELECT COUNT(*) FROM (${jsonExpr} IN (${args
					.map(() => '?')
					.join(',')})))`
			col.whereVal = args => args && args.length && [args.length, ...args]
		} else {
			col.where = `EXISTS(${jsonExpr} = ?)`
		}
	} else if (col.in) {
		if (col.where || col.whereVal)
			throw new TypeError(`${name}: cannot mix .in and where/whereVal`)
		if (col.textSearch)
			throw new TypeError(`${name}: Only one of in/textSearch allowed`)
		col.where = args => `${col.sql} IN (${args.map(() => '?').join(',')})`
		col.whereVal = args => (args && args.length ? args : false)
	} else if (col.textSearch) {
		if (col.where || col.whereVal)
			throw new TypeError(`${name}: cannot mix textSearch and where/whereVal`)
		if (col.in)
			throw new TypeError(`${name}: Only one of in/textSearch allowed`)
		col.where = `${col.sql} LIKE ?`
		col.whereVal = v => {
			if (v == null) return
			const s = String(v)
			if (s) return [`%${s}%`]
		}
	}
	col.select = `${col.sql} AS ${col.alias}`

	if (
		typeof col.where === 'string' &&
		!col.whereVal &&
		!col.where.includes('?')
	)
		throw new Error(
			`${col.name}: .where "${
				col.where
			}" should include a ? when not passing .whereVal`
		)
	if (!col.where) col.where = `${col.sql}=?`
}

const makeDefaultIdValue = idCol => obj => {
	if (obj[idCol] != null) return obj[idCol]
	return uuid.v1()
}

const makeIdValue = (idCol, {value, slugValue, type} = {}) => {
	if (type === 'INTEGER') {
		return value
			? value
			: o => {
					const id = o[idCol]
					return id || id === 0 ? id : null
			  }
	}
	// do not bind the value functions, they must be able to use other db during migrations
	if (slugValue) {
		return async function(o) {
			if (o[idCol] != null) return o[idCol]
			return uniqueSlugId(this, await slugValue(o), idCol)
		}
	}
	const defaultIdValue = makeDefaultIdValue(idCol)
	if (value) {
		return async function(o) {
			if (o[idCol] != null) return o[idCol]
			const id = await value.call(this, o)
			return id == null ? defaultIdValue(o) : id
		}
	}
	return defaultIdValue
}

const cloneModelWithDb = (m, db) => {
	const model = Object.create(m)
	model.db = db
	model._set = model._makeSetFn()
	return model
}

const makeMigrations = ({
	db,
	name: tableName,
	idCol,
	columns,
	migrations,
	migrationOptions,
}) => {
	const tableQuoted = sql.quoteId(tableName)
	const allMigrations = {
		...migrations,
		// We make id a real column to allow foreign keys
		0: ({db}) => {
			const {quoted, type, autoIncrement} = columns[idCol]
			const keySql = `${type} PRIMARY KEY ${
				autoIncrement ? 'AUTOINCREMENT' : ''
			}`
			return db.exec(
				`CREATE TABLE ${tableQuoted}(${quoted} ${keySql}, json JSON);`
			)
		},
	}
	for (const [name, col] of Object.entries(columns)) {
		// We already added these, or it's an alias
		if (name === idCol || name === 'json' || name !== col.name) continue
		const expr = col.sql.replace('tbl.', '')
		allMigrations[`0_${name}`] = ({db}) =>
			db.exec(
				`${
					col.type
						? `ALTER TABLE ${tableQuoted} ADD COLUMN ${col.quoted} ${col.type};`
						: ''
				}${
					col.index
						? `CREATE ${col.unique ? 'UNIQUE ' : ''}INDEX ${sql.quoteId(
								`${tableName}_${name}`
						  )} ON ${tableQuoted}(${expr}) ${
								col.ignoreNull ? `WHERE ${expr} IS NOT NULL` : ''
						  };`
						: ''
				}`
			)
	}

	// Wrap the migration functions to provide their arguments
	const wrappedMigrations = {}
	const wrapMigration = migration => {
		const wrap = fn =>
			fn &&
			(writeableDb => {
				if (!writeableDb.models[tableName]) {
					// Create a patched version of all models that uses the migration db
					Object.values(db.models).forEach(m => {
						writeableDb.models[m.name] = cloneModelWithDb(m, writeableDb)
					})
				}
				const model = writeableDb.models[tableName]
				return fn({...migrationOptions, db: writeableDb, model})
			})
		return wrap(migration.up || migration)
	}
	Object.keys(allMigrations).forEach(k => {
		const m = allMigrations[k]
		if (m) wrappedMigrations[k] = wrapMigration(m)
	})
	return wrappedMigrations
}

// ItemClass: Object-like class that can be assigned to like Object
// columns: object with column names each having an object with
// * value: function getting object and returning the value for the column; this creates a real column
//   * right now the column value is not regenerated for existing rows
// * slugValue: same as value, but the result is used to generate a unique slug
// * parse: process the value after getting from DB
// * jsonPath: path to a JSON value. Useful for indexing
// * sql: any sql expression
// * type: sql column type.
// * autoIncrement: INTEGER id column only: apply AUTOINCREMENT on the column
// * textSearch: perform searches as substring search with LIKE
// * get: boolean, should the column be included in find results? This also removes the value from JSON (only if name is a root-level key)
// * index: boolean, should it be indexed? If `unique` is false, NULLs are never indexed
// * unique: boolean, should the index enforce uniqueness?
// * ignoreNull: boolean, are null values ignored when enforcing uniqueness?
//   default: false if unique, else true
// migrationOptions: object with extra data passed to the migrations
class JsonModel {
	constructor(options) {
		verifyOptions(options)
		const {
			db,
			name,
			migrations,
			migrationOptions,
			columns,
			ItemClass,
			idCol = 'id',
		} = options

		this.db = db
		this.name = name
		this.quoted = sql.quoteId(name)
		this.idCol = idCol
		this.idColQ = sql.quoteId(idCol)
		this.Item = ItemClass || Object

		const idColDef = columns && columns[idCol]
		const allColumns = {
			...columns,
			[idCol]: {
				type: 'TEXT',
				alias: '_i',
				// Allow overriding type but not indexing
				...idColDef,
				slugValue: undefined,
				value: makeIdValue(idCol, idColDef),
				index: 'ALL',
				unique: true,
				get: true,
			},
			json: {
				alias: '_j',
				stringify: obj => {
					const json = JSON.stringify(obj)
					return json === '{}' ? null : json
				},
				parse: v => (v == null ? v : JSON.parse(v)),
				// Allow overriding parse/stringify but not type
				...(columns && columns.json),
				slugValue: undefined,
				value: undefined,
				type: 'JSON',
				path: '',
				get: true,
			},
		}
		// Note the order above, id and json should be calculated last
		this.columnArr = []
		this.columns = {}
		let i = 0
		for (const name of Object.keys(allColumns)) {
			const col = {...allColumns[name]}
			col.alias = col.alias || `_${i++}`
			if (this.columns[col.alias])
				throw new TypeError(
					`Cannot alias ${col.name} over existing name ${col.alias}`
				)

			normalizeColumn(col, name)
			this.columns[name] = col
			this.columns[col.alias] = col
			this.columnArr.push(col)
		}
		assignJsonParents(this.columnArr)
		for (const col of this.columnArr) prepareSqlCol(col)
		this.getCols = this.columnArr.filter(c => c.get).sort(byPathLength)

		this.db.registerMigrations(
			name,
			makeMigrations({
				db: this.db,
				name: this.name,
				columns: this.columns,
				idCol,
				migrations,
				migrationOptions,
			})
		)

		this._set = this._makeSetFn()
		// The columns we should normally fetch - json + get columns

		this.selectCols = this.columnArr.filter(c => c.get || c.name === 'json')
		this.selectColNames = this.selectCols.map(c => c.name)
		this.selectColAliases = this.selectCols.map(c => c.alias)
		this.selectColsSql = this.selectCols.map(c => c.select).join(',')
	}

	parseRow = (row, options) => {
		const mapCols =
			options && options.cols
				? options.cols.map(n => this.columns[n])
				: this.getCols
		const out = new this.Item()
		for (const k of mapCols) {
			const val = row[k.alias]
			if (val != null) {
				if (k.path) set(out, k.path, k.parse ? k.parse(val) : val)
				else Object.assign(out, k.parse(val)) // json col
			}
		}
		return out
	}

	_makeSetFn() {
		const {Item} = this
		const valueCols = this.columnArr.filter(c => c.value).sort(byPathLength)
		const realCols = this.columnArr
			.filter(c => c.real)
			.sort(byPathLengthDesc)
			.map((c, i) => ({
				...c,
				i,
				valueI: c.value && valueCols.indexOf(c),
			}))
		// This doesn't include sql expressions, you need to .get() for those
		const setCols = [...realCols].filter(c => c.get).reverse()
		const mutators = new Set()
		for (const col of valueCols) {
			for (let i = 1; i < col.parts.length; i++)
				mutators.add(col.parts.slice(0, i).join('.'))
		}
		for (const col of realCols) {
			for (let i = 1; i < col.parts.length; i++)
				if (col.get) mutators.add(col.parts.slice(0, i).join('.'))
		}
		const mutatePaths = [...mutators].sort(
			(a, b) => (a ? a.split('.').length : 0) - (b ? b.split('.').length : 0)
		)
		const cloneObj = mutatePaths.length
			? obj => {
					obj = {...obj}
					for (const path of mutatePaths) {
						set(obj, path, {...get(obj, path)})
					}
					return obj
			  }
			: obj => ({...obj})
		const colSqls = realCols.map(col => col.quoted)
		const setSql = `INTO ${this.quoted}(${colSqls.join()}) VALUES(${colSqls
			.map(() => '?')
			.join()})`
		const insertSql = `INSERT ${setSql}`
		const updateSql = `INSERT OR REPLACE ${setSql}`
		return async (o, insertOnly) => {
			const obj = cloneObj(o)
			const results = await Promise.all(
				valueCols.map(col =>
					// value functions must be able to use other db during migrations, so call with our this
					col.value.call(this, obj)
				)
			)
			results.forEach((r, i) => {
				const col = valueCols[i]
				if (col.get && col.path) set(obj, col.path, r)
			})
			const colVals = realCols.map(col => {
				let v
				if (col.path) {
					if (col.value) v = results[col.valueI]
					else v = get(obj, col.path)
					if (col.get) set(obj, col.path, undefined)
				} else {
					v = obj
				}
				return col.stringify ? col.stringify(v) : v
			})

			// The json field is part of the colVals
			// eslint-disable-next-line promise/no-nesting
			return this.db
				.run(insertOnly ? insertSql : updateSql, colVals)
				.then(result => {
					// Return what get(id) would return
					const newObj = new Item()
					setCols.forEach(col => {
						const val = colVals[col.i]
						const v = col.parse ? col.parse(val) : val
						if (col.path === '') Object.assign(newObj, v)
						else set(newObj, col.path, v)
					})
					if (newObj[this.idCol] == null) {
						// This can only happen for integer ids, so we use the last inserted rowid
						newObj[this.idCol] = result.lastID
					}
					return newObj
				})
		}
	}

	_colSql(colName) {
		return this.columns[colName] ? this.columns[colName].sql : colName
	}

	// Converts a row or array of rows to objects
	toObj = (thing, options) => {
		if (!thing) {
			return
		}
		if (Array.isArray(thing)) {
			return thing.map(r => this.parseRow(r, options))
		}
		return this.parseRow(thing, options)
	}

	// Override this function to implement search behaviors
	// attrs: literal value search, for convenience
	// where: sql expressions as keys with arrays of applicable parameters as values
	// join: arbitrary join clause. Not processed at all
	// joinVals: values needed by the join clause
	// sort: object with sql expressions as keys and 1/-1 for direction
	// limit: max number of rows to return
	// offset: number of rows to skip
	// cols: override the columns to select
	// eslint-disable-next-line complexity
	makeSelect(options) {
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
		let {
			cols,
			attrs,
			join,
			joinVals,
			where,
			limit,
			offset,
			sort,
			cursor,
			noCursor,
			noTotal,
		} = options
		cols = cols || this.selectColNames
		let cursorColNames, cursorQ, cursorArgs
		const makeCursor = limit && !noCursor

		if (makeCursor || cursor) {
			// We need a tiebreaker sort for cursors
			sort = sort && sort[this.idCol] ? sort : {...sort, [this.idCol]: 100000}
		}
		const sortNames =
			sort &&
			Object.keys(sort)
				.filter(k => sort[k])
				.sort((a, b) => Math.abs(sort[a]) - Math.abs(sort[b]))
		if (makeCursor || cursor) {
			let copiedCols = false
			// We need the sort columns in the output to get the cursor value
			sortNames.forEach(colName => {
				if (!cols.includes(colName)) {
					if (!copiedCols) {
						cols = [...cols]
						copiedCols = true
					}
					cols.push(colName)
				}
			})
			cursorColNames =
				cols === this.selectColNames
					? this.selectColAliases
					: sortNames.map(c => (this.columns[c] ? this.columns[c].alias : c))
		}

		if (cursor) {
			// Create the sort condition for keyset pagination
			// a >= v0 && (a != v0 || (b >= v1 && (b != v1 || (c > v3))))
			const vals = jsurl.parse(cursor)
			const getDir = i => (sort[sortNames[i]] < 0 ? '<' : '>')
			const l = vals.length - 1
			cursorQ = `${cursorColNames[l]}${getDir(l)}?`
			cursorArgs = [vals[l]]
			for (let i = l - 1; i >= 0; i--) {
				cursorQ =
					`(${cursorColNames[i]}${getDir(i)}=?` +
					` AND (${cursorColNames[i]}!=? OR ${cursorQ}))`
				const val = vals[i]
				cursorArgs.unshift(val, val)
			}
		}

		const colsSql =
			cols === this.selectColNames
				? this.selectColsSql
				: cols
						.map(c => (this.columns[c] ? this.columns[c].select : c))
						.join(',')
		const selectQ = `SELECT ${colsSql} FROM ${this.quoted} tbl`

		const vals = []
		const conds = []
		if (where) {
			for (const w of Object.keys(where)) {
				const val = where[w]
				if (val) {
					if (!Array.isArray(val)) {
						throw new TypeError(
							`Error: Got where without array of args for makeSelect: ${w}, val: ${val}`
						)
					}
					conds.push(w)
					vals.push(...where[w])
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
			sortNames &&
			sortNames.length &&
			`ORDER BY ${sortNames
				.map(k => {
					const col = this.columns[k]
					// If we selected we can use the alias
					const sql = col ? (cols.includes(col.name) ? col.alias : col.sql) : k
					return `${sql}${sort[k] < 0 ? ` DESC` : ``}`
				})
				.join(',')}`

		// note: if preparing, this can be replaced with LIMIT(?,?)
		// First is offset (can be 0) and second is limit (-1 for no limit)
		const limitQ = limit && `LIMIT ${Number(limit) || 10}`
		const offsetQ = offset && `OFFSET ${Number(offset) || 0}`

		if (join && joinVals && joinVals.length) {
			vals.unshift(...joinVals)
		}

		const calcTotal = !(noTotal || noCursor)
		const allConds = cursorQ ? [...conds, cursorQ] : conds
		const allVals = cursorArgs ? [...(vals || []), ...cursorArgs] : vals
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
		return [q, allVals, cursorColNames, totalQ, vals]
	}

	searchOne(attrs, options) {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			limit: 1,
			noCursor: true,
		})
		return this.db.get(q, vals).then(this.toObj)
	}

	// returns {items[], cursor}. If no cursor, you got all the results
	// cursor: pass previous cursor to get the next page
	// Note: To be able to query the previous page with a cursor, we need to invert the sort and then reverse the result rows
	async search(attrs, {itemsOnly, ...options} = {}) {
		const [q, vals, cursorKeys, totalQ, totalVals] = this.makeSelect({
			attrs,
			noCursor: itemsOnly,
			...options,
		})
		const [rows, totalO] = await Promise.all([
			this.db.all(q, vals),
			totalQ && this.db.get(totalQ, totalVals),
		])
		const items = this.toObj(rows, options)
		if (itemsOnly) return items
		let cursor
		if (
			options &&
			!options.noCursor &&
			options.limit &&
			rows.length === options.limit
		) {
			const last = rows[rows.length - 1]
			cursor = jsurl.stringify(cursorKeys.map(k => last[k]), {
				short: true,
			})
		}
		const out = {items, cursor}
		if (totalO) out.total = totalO.t
		return out
	}

	searchAll(attrs, options) {
		return this.search(attrs, {...options, itemsOnly: true})
	}

	exists(attrs, options) {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			sort: undefined,
			limit: 1,
			offset: undefined,
			noCursor: true,
			cols: ['1'],
		})
		return this.db.get(q, vals).then(row => !!row)
	}

	count(attrs, options) {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			cols: ['COUNT(*) AS c'],
		})
		return this.db.get(q, vals).then(row => row.c)
	}

	numAggOp(op, colName, attrs, options) {
		const col = this.columns[colName]
		const sql = (col && col.sql) || colName
		const o = {
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			cols: [`${op}(CAST(${sql} AS NUMERIC)) AS val`],
		}
		if (col && col.ignoreNull) {
			// Make sure we can use the index
			o.where = {...o.where, [`${sql} IS NOT NULL`]: []}
		}
		const [q, vals] = this.makeSelect(o)
		return this.db.get(q, vals).then(row => row.val)
	}

	max(colName, attrs, options) {
		return this.numAggOp('MAX', colName, attrs, options)
	}

	min(colName, attrs, options) {
		return this.numAggOp('MIN', colName, attrs, options)
	}

	sum(colName, attrs, options) {
		return this.numAggOp('SUM', colName, attrs, options)
	}

	avg(colName, attrs, options) {
		return this.numAggOp('AVG', colName, attrs, options)
	}

	all() {
		return this.db
			.all(`SELECT ${this.selectColsSql} FROM ${this.quoted} tbl`)
			.then(this.toObj)
	}

	get(id, colName = this.idCol) {
		if (id == null) {
			return Promise.reject(
				new Error(`No "${colName}" given for "${this.name}"`)
			)
		}
		const where = this.columns[colName].sql
		return this.db
			.get(
				`SELECT ${this.selectColsSql} FROM ${
					this.quoted
				} tbl WHERE ${where} = ?`,
				[id]
			)
			.then(this.toObj)
	}

	getAll(ids, colName = this.idCol) {
		const qs = ids.map(() => '?').join()
		const where = this.columns[colName].sql
		return this.db
			.all(
				`SELECT ${this.selectColsSql} FROM ${
					this.quoted
				} tbl WHERE ${where} IN (${qs})`,
				ids
			)
			.then(rows => {
				const objs = this.toObj(rows)
				return ids.map(id => objs.find(o => o[colName] === id))
			})
	}

	getCached(cache, id, colName = this.idCol) {
		const key = `_DL_${this.name}_${colName}`
		if (!cache[key]) {
			dbg(`creating DataLoader for ${this.name}.${colName}`)
			// batchSize: max is SQLITE_MAX_VARIABLE_NUMBER, default 999. Lower => less latency
			cache[key] = new DataLoader(ids => this.getAll(ids, colName), {
				maxBatchSize: 100,
			})
		}
		return cache[key].load(id)
	}

	// --- Mutator methods below ---

	// Contract: All subclasses use set() to store values
	set(obj, insertOnly) {
		// we cannot store `set` directly on the instance because it would override subclass `set` functions
		return this._set(obj, insertOnly)
	}

	// Change only the given fields, shallowly
	// upsert: also allow inserting
	async updateNoTrans(obj, upsert) {
		if (!obj) throw new Error('update() called without object')
		const id = obj[this.idCol]
		if (id == null) {
			if (!upsert) throw new Error('Can only update object with id')
			return this.set(obj)
		}
		const prev = await this.get(id)
		if (!upsert && !prev) throw new Error(`No object with id ${id} exists yet`)
		return this.set({...prev, ...obj})
	}

	update(obj, upsert) {
		return this.db.withTransaction(() => this.updateNoTrans(obj, upsert))
	}

	remove(idOrObj) {
		const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		return this.db.run(
			`DELETE FROM ${this.quoted} WHERE ${this.idColQ} = ?`,
			id
		)
	}

	delete(idOrObj) {
		if (DEV) deprecated('deleteMethod', 'use .remove() instead of .delete()')
		return this.remove(idOrObj)
	}

	changeId(oldId, newId) {
		if (newId == null) throw new TypeError('newId must be a valid id')
		const {quoted} = this.columns[this.idCol]
		return this.db
			.run(`UPDATE ${this.quoted} SET ${quoted} = ? WHERE ${quoted} = ?`, [
				newId,
				oldId,
			])
			.then(({changes}) => {
				if (changes !== 1) throw new Error(`row with id ${oldId} not found`)
				return undefined
			})
	}

	async applyChanges(result) {
		const {rm, set, ins, upd, sav} = result
		if (DEV) {
			const {rm, set, ins, upd, sav, ...rest} = result
			Object.keys(rest).forEach(k => unknown(k, `key ${k} in result`))
		}
		if (rm) await Promise.all(rm.map(item => this.remove(item)))
		if (ins) await Promise.all(ins.map(obj => this.set(obj, true)))
		if (set) await Promise.all(set.map(obj => this.set(obj)))
		if (upd) await Promise.all(upd.map(obj => this.updateNoTrans(obj)))
		if (sav) await Promise.all(sav.map(obj => this.updateNoTrans(obj, true)))
	}
}

export default JsonModel
