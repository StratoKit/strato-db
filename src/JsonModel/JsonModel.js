import debug from 'debug'
import jsurl from 'jsurl2'
import {sql} from '../DB'
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
import {verifyOptions, verifyColumn} from './verifyOptions'
import {makeMigrations} from './makeMigrations'
import {makeIdValue} from './makeDefaultIdValue'
import {settleAll} from '../lib/settleAll'
import {DEV, deprecated} from '../lib/warning'

const dbg = debug('strato-db/JSON')

/**
 * JsonModel is a simple document store. It stores its data in SQLite as a table, one row
 * per object (document). Each object must have a unique ID, normally at `obj.id`.
 */

/**
 * A stored object. It will always have a value for the `id` column
 *
 * A table-unique identifier
 *
 * simple equality lookup values for searching.
 *
 * @class JsonModelImpl
 * @template Item
 * @template IDCol
 * @implements {JsonModel<Item, IDCol>}
 */
class JsonModelImpl {
	/** @param {JMOptions<Item, IDCol>} options  - the model declaration. */
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
			keepRowId = true,
		} = options

		this.db = db
		this.name = name
		this.quoted = sql.quoteId(name)
		this.idCol = idCol
		this.idColQ = sql.quoteId(idCol)
		this.Item = ItemClass

		const idColDef = (columns && columns[idCol]) || {}
		const jsonColDef = (columns && columns.json) || {}
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
		this.columns = {}
		let i = 0
		for (const colName of Object.keys(allColumns)) {
			const colDef = allColumns[colName]
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

			normalizeColumn(col, colName)
			this.columns[colName] = col
			this.columns[col.alias] = col
			this.columnArr.push(col)
		}
		assignJsonParents(this.columnArr)
		for (const col of this.columnArr) prepareSqlCol(col, this.name)
		this.getCols = this.columnArr.filter(c => c.get).sort(byPathLength)

		this.db.registerMigrations(
			name,
			makeMigrations({
				name: this.name,
				columns: this.columns,
				idCol,
				keepRowId,
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
		/** @type {JMColumnDef<Item, IDCol>[]} */
		const mapCols =
			options && options.cols
				? options.cols.map(n => this.columns[n])
				: this.getCols
		const out = this.Item ? new this.Item() : {}
		for (const k of mapCols) {
			let val
			if (dbg.enabled) {
				try {
					val = k.parse ? k.parse(row[k.alias]) : row[k.alias]
				} catch {
					dbg(
						`!!! ${this.name}.${k.name}:  parse failed for value ${String(
							row[k.alias]
						).slice(0, 20)}`
					)
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

	_makeSetFn() {
		const {db, Item, columnArr, quoted, idCol, name} = this
		const valueCols = columnArr.filter(c => c.value).sort(byPathLength)
		const realCols = columnArr
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
		const setSql = `INTO ${quoted}(${colSqls.join(',')}) VALUES(${colSqls
			.map(() => '?')
			.join(',')})`
		return async (o, insertOnly, noReturn) => {
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
			})

			// The json field is part of the colVals
			const P = insertOnly ? _insertSql.run(colVals) : _updateSql.run(colVals)
			return noReturn
				? P
				: P.then(result => {
						// Return what get(id) would return
						const newObj = Item ? new Item() : {}
						for (const col of setCols) {
							const val = colVals[col.i]
							const v = col.parse ? col.parse(val) : val
							if (col.path === '') Object.assign(newObj, v)
							else set(newObj, col.path, v)
						}
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

	/**
	 * Parses query options into query parts. Override this function to implement
	 * search behaviors.
	 */
	makeSelect(/** @type{JMSearchOptions} */ options) {
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
			where: extraWhere,
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
			sort = sort && sort[this.idCol] ? sort : {...sort, [this.idCol]: 100_000}
		}
		const sortNames =
			sort &&
			Object.keys(sort)
				.filter(k => sort[k])
				.sort((a, b) => Math.abs(sort[a]) - Math.abs(sort[b]))
		if (makeCursor || cursor) {
			let copiedCols = false
			// We need the sort columns in the output to get the cursor value
			for (const colName of sortNames) {
				if (!cols.includes(colName)) {
					if (!copiedCols) {
						cols = [...cols]
						copiedCols = true
					}
					cols.push(colName)
				}
			}
			cursorColNames = sortNames.map(c =>
				this.columns[c] ? this.columns[c].alias : c
			)
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
					vals.push(...extraWhere[w])
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
					const colSql = col
						? cols.includes(col.name)
							? col.alias
							: col.sql
						: k
					return `${colSql}${sort[k] < 0 ? ` DESC` : ``}`
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

	/**
	 * Search the first matching object.
	 *
	 * @param {JMSearchAttrs}   attrs      - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<Item | null>} - the result or null if no match.
	 */
	searchOne(attrs, options) {
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			limit: 1,
			noCursor: true,
		})
		return this.db.get(q, vals).then(this.toObj)
	}

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
			rows.length === options.limit &&
			(!totalQ || totalO?.t > options.limit)
		) {
			const last = rows[rows.length - 1]
			cursor = jsurl.stringify(
				cursorKeys.map(k => last[k]),
				{short: true}
			)
		}
		return {items, cursor, total: totalO?.t}
	}

	searchAll(attrs, options) {
		return this.search(attrs, {...options, itemsOnly: true})
	}

	/**
	 * Check for existence of objects. Returns `true` if the search would yield
	 * results.
	 *
	 * @returns {Promise<boolean>} The search results exist.
	 */
	exists(idOrAttrs, options) {
		if (idOrAttrs && typeof idOrAttrs !== 'object') {
			if (this._existsSql?.db !== this.db) {
				const where = this.columns[this.idCol].sql
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
			cols: ['1'],
		})
		return this.db.get(q, vals).then(row => !!row)
	}

	/**
	 * Count of search results.
	 *
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the count.
	 */
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

	/**
	 * Numeric Aggregate Operation.
	 *
	 * @param {string}          op         - the SQL function, e.g. MAX.
	 * @param {JMColName}       colName    - column to aggregate.
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the result.
	 */
	numAggOp(op, colName, attrs, options) {
		const col = this.columns[colName]
		const colSql = (col && col.sql) || colName
		const o = {
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			cols: [`${op}(CAST(${colSql} AS NUMERIC)) AS val`],
		}
		if (col && col.ignoreNull) {
			// Make sure we can use the index
			o.where = {...o.where, [`${colSql} IS NOT NULL`]: []}
		}
		const [q, vals] = this.makeSelect(o)
		return this.db.get(q, vals).then(row => row.val)
	}

	/**
	 * Maximum value.
	 *
	 * @param {JMColName}       colName    - column to aggregate.
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the result.
	 */
	max(colName, attrs, options) {
		return this.numAggOp('MAX', colName, attrs, options)
	}

	/**
	 * Minimum value.
	 *
	 * @param {JMColName}       colName    - column to aggregate.
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the result.
	 */
	min(colName, attrs, options) {
		return this.numAggOp('MIN', colName, attrs, options)
	}

	/**
	 * Sum values.
	 *
	 * @param {JMColName}       colName    - column to aggregate.
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the result.
	 */
	sum(colName, attrs, options) {
		return this.numAggOp('SUM', colName, attrs, options)
	}

	/**
	 * Average value.
	 *
	 * @param {JMColName}       colName    - column to aggregate.
	 * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
	 * @param {JMSearchOptions} [options]  - search options.
	 * @returns {Promise<number>} - the result.
	 */
	avg(colName, attrs, options) {
		return this.numAggOp('AVG', colName, attrs, options)
	}

	/**
	 * Get all objects.
	 *
	 * @returns {Promise<Item[]>} - the table contents.
	 */
	all() {
		if (this._allSql?.db !== this.db)
			this._allSql = this.db.prepare(
				`SELECT ${this.selectColsSql} FROM ${this.quoted} tbl`,
				`all ${this.name}`
			)
		return this._allSql.all().then(this.toObj)
	}

	/**
	 * Get an object by a unique value, like its ID.
	 *
	 * @param {IDValue} id                    - the value for the column.
	 * @param {string}  [colName=this.idCol]  - the columnname, defaults to the ID
	 *                                        column.
	 * @returns {Promise<Item | null>} - the object if it exists.
	 */
	get(id, colName = this.idCol) {
		if (id == null) {
			return Promise.reject(
				new Error(`No id given for "${this.name}.${colName}"`)
			)
		}
		const col = this.columns[colName]
		if (!col)
			return Promise.reject(
				new Error(`Unknown column "${colName}" given for "${this.name}"`)
			)
		if (col._getSql?.db !== this.db) {
			col._getSql = this.db.prepare(
				`SELECT ${this.selectColsSql} FROM ${this.quoted} tbl WHERE ${col.sql} = ?`,
				`get ${this.name}.${colName}`
			)
		}
		return col._getSql.get([id]).then(this.toObj)
	}

	/**
	 * Get several objects by their unique value, like their ID.
	 *
	 * @param {IDValue[]} ids                   - the values for the column.
	 * @param {string}    [colName=this.idCol]  - the columnname, defaults to the
	 *                                          ID column.
	 * @returns {Promise<(Item | null)[]>} - the objects, or null where they don't
	 *                                     exist, in order of their requested ID.
	 */
	async getAll(ids, colName = this.idCol) {
		let {path, _getAllSql} = this.columns[colName]
		if (_getAllSql?.db !== this.db) {
			const {sql: where, real, get: isSelected} = this.columns[colName]
			if (real && !isSelected)
				throw new Error(
					`JsonModel: Cannot getAll on get:false column ${colName}`
				)
			_getAllSql = this.db.prepare(
				`SELECT ${this.selectColsSql} FROM ${this.quoted} tbl WHERE ${where} IN (SELECT value FROM json_each(?))`,
				`get ${this.name}.${colName}`
			)
			this.columns[colName]._getAllSql = _getAllSql
		}
		if (!ids?.length) return []
		if (ids.length === 1) return [await this.get(ids[0], colName)]
		const rows = await _getAllSql.all([JSON.stringify(ids)])
		const objs = this.toObj(rows)
		return ids.map(id => objs.find(o => get(o, path) === id))
	}

	_ensureLoader(/** @type{JMCache<Item,IDCol> */ cache, colName) {
		if (!cache) throw new Error(`cache is required`)
		const key = `_DL_${this.name}_${colName}`
		if (!cache[key]) {
			dbg(`creating DataLoader ${key}`)
			// batchSize: max is SQLITE_MAX_VARIABLE_NUMBER, default 999. Lower => less latency
			cache[key] = new DataLoader(ids => this.getAll(ids, colName), {
				maxBatchSize: 100,
			})
		}
		return cache[key]
	}

	getCached(cache, id, colName = this.idCol) {
		if (!cache) return this.get(id, colName)
		return this._ensureLoader(cache, colName).load(id)
	}

	/**
	 * Lets you clear all the cache or just a key. Useful for when you change only
	 * some items.
	 *
	 * @param {Object} cache                 - the lookup cache. It is managed with
	 *                                       DataLoader.
	 * @param {ID}     [id]                  - the value for the column.
	 * @param {string} [colName=this.idCol]  - the columnname, defaults to the ID
	 *                                       column.
	 * @returns {Loader} - the actual cache, you can call `.prime(key, value)` on
	 *                   it to insert a value.
	 */
	clearCache(cache, id, colName = this.idCol) {
		const loader = this._ensureLoader(cache, colName)
		if (id) return loader.clear(id)
		return loader.clearAll()
	}

	// I wish I could use these types
	// @typedef {(o: Item) => Promise<void>} RowCallback
	// @typedef {
	// 	(fn: RowCallback) => Promise<void> |
	// 	(attrs: JMSearchAttrs, fn: RowCallback) => Promise<void> |
	// 	(attrs: JMSearchAttrs, options: JMSearchOptions, fn: RowCallback) => Promise<void>
	// } EachFn
	/**
	 * Iterate through search results. Calls `fn` on every result.
	 * The iteration uses a cursored search, so changes to the model during the
	 * iteration can influence the iteration.
	 *
	 * @param {JMSearchAttrs | RowCallback} attrsOrFn
	 * @param {RowCallback | JMSearchOptions} [optionsOrFn]
	 * @param {RowCallback} [fn]
	 * @returns {Promise<void>} Table iteration completed.
	 */
	async each(attrsOrFn, optionsOrFn, fn) {
		if (!fn) {
			if (optionsOrFn) {
				if (typeof optionsOrFn === 'function') {
					fn = optionsOrFn
					optionsOrFn = undefined
				} else {
					fn = optionsOrFn.fn
					delete optionsOrFn.fn
				}
			} else if (typeof attrsOrFn === 'function') {
				fn = attrsOrFn
				attrsOrFn = undefined
			}
			if (!fn) throw new Error('each requires function')
		}
		if (!optionsOrFn) optionsOrFn = {}
		// In the next major release, limit will apply to the total amount, not the batch size
		const {
			concurrent = 5,
			batchSize = 50,
			limit = batchSize,
			...rest
		} = optionsOrFn
		optionsOrFn.noCursor = false
		optionsOrFn.noTotal = true
		let cursor
		let i = 0
		do {
			const result = await this.search(attrsOrFn, {...rest, limit, cursor})
			cursor = result.cursor
			await settleAll(result.items, async v => fn(v, i++), concurrent)
		} while (cursor)
	}

	// --- Mutator methods below ---

	// Contract: All subclasses use set() to store values
	set(...args) {
		// we cannot store `set` directly on the instance because it would override subclass `set` functions
		return this._set(...args)
	}

	// Change only the given fields, shallowly
	// upsert: also allow inserting
	async updateNoTrans(obj, upsert, noReturn) {
		if (!obj) throw new Error('update() called without object')
		const id = obj[this.idCol]
		if (id == null) {
			if (!upsert) throw new Error('Can only update object with id')
			return this.set(obj, false, noReturn)
		}
		let prev = await this.get(id)
		if (!upsert && !prev) throw new Error(`No object with id ${id} exists yet`)
		if (prev)
			for (const [key, value] of Object.entries(obj)) {
				if (value == null) delete prev[key]
				else prev[key] = value
			}
		else prev = obj
		return this.set(prev, false, noReturn)
	}

	/**
	 * Update or upsert an object.
	 *
	 * @param {Object}  obj         The changes to store, including the id field.
	 * @param {boolean} [upsert]    Insert the object if it doesn't exist.
	 * @param {boolean} [noReturn]  Do not return the stored object.
	 * @returns {Promise<Item | undefined>} A copy of the stored object.
	 */
	update(obj, upsert, noReturn) {
		// Update needs to read the object to apply the changes, so it needs a transaction
		if (this.db.inTransaction) return this.updateNoTrans(obj, upsert, noReturn)
		return this.db.withTransaction(() =>
			this.updateNoTrans(obj, upsert, noReturn)
		)
	}

	/**
	 * Remove an object. If the object doesn't exist, this doesn't do anything.
	 *
	 * @param {ID | Object} idOrObj  The id or the object itself.
	 * @returns {Promise<void>} A promise for the deletion.
	 */
	remove(idOrObj) {
		const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		if (this._deleteSql?.db !== this.db)
			this._deleteSql = this.db.prepare(
				`DELETE FROM ${this.quoted} WHERE ${this.idColQ} = ?`,
				`del ${this.name}`
			)
		return this._deleteSql.run([id])
	}

	delete(idOrObj) {
		if (DEV) deprecated('deleteMethod', 'use .remove() instead of .delete()')
		return this.remove(idOrObj)
	}

	/**
	 * "Rename" an object.
	 *
	 * @param {ID} oldId  The current ID. If it doesn't exist this will throw.
	 * @param {ID} newId  The new ID. If this ID is already in use this will throw.
	 * @returns {Promise<void>} A promise for the rename.
	 */
	changeId(oldId, newId) {
		if (newId == null) throw new TypeError('newId must be a valid id')
		let {_changeIdSql} = this.columns[this.idCol]
		if (_changeIdSql?.db !== this.db) {
			const {quoted} = this.columns[this.idCol]
			_changeIdSql = this.db.prepare(
				`UPDATE ${this.quoted} SET ${quoted} = ? WHERE ${quoted} = ?`,
				`mv ${this.name}`
			)
			this.columns[this.idCol]._changeIdSql = _changeIdSql
		}
		return _changeIdSql.run([newId, oldId]).then(({changes}) => {
			if (changes !== 1) throw new Error(`row with id ${oldId} not found`)
			return undefined
		})
	}
}

export default JsonModelImpl
