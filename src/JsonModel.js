import debug from 'debug'
import uuid from 'uuid'
import jsurl from 'jsurl'
import {sql, valToSql} from './DB'
import {uniqueSlugId} from './slugify'
import DataLoader from 'dataloader'

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

const cloneModelWithDb = (m, db) => {
	const model = Object.create(m)
	model.db = db
	model.parseRow = model._makeParseRow()
	model._set = model._makeSetFn()
	return model
}

const allowedTypes = {
	TEXT: true,
	NUMERIC: true,
	INTEGER: true,
	REAL: true,
	BLOB: true,
	JSON: true,
}
const knownColProps = {
	alias: true,
	autoIncrement: true,
	default: true,
	get: true,
	ignoreNull: true,
	in: true,
	index: true,
	isAnyOfArray: true,
	isArray: true,
	jsonPath: true,
	parse: true,
	slugValue: true,
	sql: true,
	textSearch: true,
	type: true,
	unique: true,
	value: true,
	where: true,
	whereVal: true,
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
	constructor({
		db,
		name,
		migrations,
		migrationOptions,
		columns,
		ItemClass,
		idCol = 'id',
	}) {
		if (!db || !name) {
			throw new Error('db and name are required')
		}
		this.db = db
		this.name = name
		this.quoted = sql.quoteId(name)
		this.idCol = idCol
		this.idColQ = sql.quoteId(idCol)
		this.Item = ItemClass || Object
		// do not bind the value functions, they must be able to use other db during migrations
		let idValue = this._defaultIdValue
		if (columns && columns[idCol]) {
			const {value, slugValue, type} = columns[idCol]
			if (type === 'INTEGER') {
				idValue = value
					? value
					: o => {
							const id = o[idCol]
							return id || id === 0 ? id : null
					  }
			} else if (value) {
				idValue = async function(o) {
					if (o[idCol] != null) return o[idCol]
					const id = await value.call(this, o)
					return id == null ? this._defaultIdValue(o) : id
				}
			} else if (slugValue) {
				idValue = false
			}
		}
		this.columns = {
			...columns,
			[idCol]: {
				type: 'TEXT',
				// Allow overriding type but not indexing
				...(columns && columns[idCol]),
				value: idValue,
				index: true,
				unique: true,
				ignoreNull: false,
				get: true,
			},
			json: {
				// Strip "get" columns from stored JSON (including id)
				value: obj => {
					const json = JSON.stringify({...obj, ...this.jsonMask})
					return json === '{}' ? null : json
				},
				parse: JSON.parse,
				// Allow overriding parse/stringify but not type
				...(columns && columns.json),
				type: 'JSON',
				get: false,
			},
		}
		// Note the order above, id and json should be calculated last
		const colKeys = Object.keys(this.columns)
		this.columnArr = []
		this.jsonMask = {}

		// eslint-disable-next-line complexity
		colKeys.forEach((name, i) => {
			const col = {...this.columns[name]}
			this.columns[name] = col

			col.alias = col.alias || `_${i}`
			if (this.columns[col.alias])
				throw new TypeError(
					`Cannot alias ${col.name} over existing name ${col.alias}`
				)
			this.columns[col.alias] = col

			Object.keys(col).forEach(k => {
				if (!knownColProps[k])
					throw new TypeError(`${name}: unknown column prop ${k}`)
			})
			if (col.type && !allowedTypes[col.type])
				throw new TypeError(
					`${col.name}: type ${col.type} is not one of ${Object.keys(
						allowedTypes
					).join(' ')}`
				)

			if (col.unique) {
				if (!col.index)
					throw new TypeError(`${name}: unique requires index: true`)
			} else if (col.ignoreNull == null) {
				col.ignoreNull = true
			}

			col.name = name
			col.quoted = sql.quoteId(name)

			if (col.slugValue) {
				if (col.value)
					throw new TypeError(
						`${name}: slugValue and value can't both be defined`
					)
				if (!col.index)
					throw new TypeError(`${name}: index is required when using slugValue`)
				col.value = async function(o) {
					if (o[name]) return o[name]
					return uniqueSlugId(this, await col.slugValue(o), name, o[this.idCol])
				}
			}

			if (col.jsonPath) {
				if (col.get)
					throw new TypeError(`${name}: Cannot use get on jsonPath column`)
				if (col.value || col.sql)
					throw new TypeError(`${name}: Only one of jsonPath/value/sql allowed`)
				if (col.isAnyOfArray) {
					col.isArray = true
					col.in = true
				}
				if (col.isArray) {
					if (col.in) {
						col.where = arg =>
							`EXISTS(SELECT 1 FROM json_each(tbl.json, "$.${
								col.jsonPath
							}") j WHERE j.value IN (${arg.map(() => '?').join(',')}))`
						col.whereVal = matchThese => matchThese
					} else {
						col.where = `EXISTS(SELECT 1 FROM json_each(tbl.json, "$.${
							col.jsonPath
						}") j WHERE j.value = ?)`
					}
				}
				col.sql = `json_extract(json, '$.${col.jsonPath}')`
			} else {
				if (col.isArray)
					throw new TypeError(
						`${name}: jsonPath is required when using isArray`
					)
				if (col.sql) {
					if (col.get)
						throw new TypeError(`${name}: Cannot use get on sql column`)

					if (col.value)
						throw new TypeError(
							`${name}: Only one of jsonPath/value/sql allowed`
						)
				} else {
					if (!col.value)
						throw new TypeError(`${name}: One of jsonPath/value/sql required`)
					col.sql = col.quoted
				}
			}

			if (col.default != null) {
				col.ignoreNull = false
				if (col.value) {
					const prev = col.value
					col.value = async o => {
						const r = await prev(o)
						return r == null ? col.default : r
					}
				} else {
					col.sql = `ifNull(${col.sql},${valToSql(col.default)})`
				}
			}

			if (col.in) {
				if (col.textSearch)
					throw new TypeError(`${name}: Only one of in/textSearch allowed`)
				if (!col.isArray) {
					col.where = arg => `${col.sql} IN (${arg.map(() => '?').join(',')})`
					col.whereVal = matchThese => matchThese
				}
			}
			if (col.textSearch) {
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

			if (col.get) {
				// Mark root key with same name for removal when stringifying
				this.jsonMask[name] = undefined
			}

			// Stringify/parse JSON type columns
			if (col.value && col.type === 'JSON' && !col.parse) {
				const prevValue = col.value
				col.value = obj => JSON.stringify(prevValue(obj))
				col.parse = s => (s == null ? s : JSON.parse(s))
			}

			if (col.parse && (!col.value || !col.get) && col.name !== 'json')
				throw new TypeError(
					`${col.name}: parse() requires a value function and get:true`
				)

			this.columnArr.push(col)
		})

		const allMigrations = {
			...migrations,
			0: {
				// We make id a real column to allow foreign keys
				up: ({db}) => {
					const {quoted, type, autoIncrement} = this.columns[idCol]
					const keySql = `${type} PRIMARY KEY ${
						type === 'INTEGER' && autoIncrement ? 'AUTOINCREMENT' : ''
					}`
					return db.exec(`
						CREATE TABLE ${this.quoted}(${quoted} ${keySql}, json JSON);
					`)
				},
				down: ({db}) =>
					db.exec(`
						DROP TABLE ${this.quoted};
					`),
			},
		}
		for (const col of this.columnArr) {
			// We already added these
			if (col.name === idCol || col.name === 'json') {
				continue
			}

			allMigrations[`0_${col.name}`] = {
				up: ({db}) =>
					db.exec(`
					${
						col.value
							? `ALTER TABLE ${this.quoted} ADD COLUMN ${
									col.quoted
							  } ${col.type || 'BLOB'};`
							: ''
					}
					${
						col.index
							? `CREATE ${col.unique ? 'UNIQUE' : ''} INDEX ${sql.quoteId(
									`${name}_${col.name}`
							  )}
						ON ${this.quoted}(${col.sql})
						${col.ignoreNull ? `WHERE ${col.sql} IS NOT NULL` : ''};
					`
							: ''
					}
				`),
			}
		}

		// Wrap the migration functions to provide their arguments
		const wrappedMigrations = {}
		const wrapMigration = m => {
			const wrap = key =>
				m[key] &&
				(db => {
					if (!db.models[name]) {
						// Create a patched version of all models that uses the migration db
						Object.values(this.db.models).forEach(m => {
							db.models[m.name] = cloneModelWithDb(m, db)
						})
					}
					const model = db.models[name]
					return m[key]({...migrationOptions, db, model})
				})
			return {
				up: wrap('up'),
				down: wrap('down'),
			}
		}
		Object.keys(allMigrations).forEach(k => {
			const m = allMigrations[k]
			if (m) wrappedMigrations[k] = wrapMigration(m)
		})

		this.db.registerMigrations(name, wrappedMigrations)

		this.parseRow = this._makeParseRow()
		this._set = this._makeSetFn()
		// The columns we should normally fetch - json + get columns

		this.selectCols = this.columnArr.filter(c => c.get || c.name === 'json')
		this.selectColNames = this.selectCols.map(c => c.name)
		this.selectColAliases = this.selectCols.map(c => c.alias)
		this.selectColsSql = this.selectCols.map(c => c.select).join(',')
	}

	_defaultIdValue(obj) {
		// Allow 0 as id
		if (obj[this.idCol] == null) {
			return uuid.v1()
		}
		return obj[this.idCol]
	}

	// Creates this.parseRow
	_makeParseRow() {
		const getCols = this.columnArr.filter(c => c.get)
		const jsonAlias = this.columns.json.alias
		const jsonParse = this.columns.json.parse
		return (row, options) => {
			const mapCols =
				options && options.cols
					? options.cols.map(n => this.columns[n])
					: getCols
			const out = new this.Item()
			for (const k of mapCols) {
				const val = row[k.alias]
				if (val != null) {
					out[k.name] = k.parse ? k.parse(val) : val
				}
			}
			if (row[jsonAlias]) {
				Object.assign(out, jsonParse(row[jsonAlias]))
			}
			return out
		}
	}

	_makeSetFn() {
		const {columnArr, Item} = this
		const valueCols = columnArr.filter(col => col.value)
		const colSqls = valueCols.map(col => col.sql)
		const setSql = `
			INTO
				${this.quoted}(${colSqls.join(',')})
			VALUES(${colSqls.map(() => '?').join(',')})
		`
		const insertSql = `INSERT ${setSql}`
		const updateSql = `INSERT OR REPLACE ${setSql}`
		const selectIdxs = valueCols
			.map(({get, name, parse}, i) => ({get, name, parse, i}))
			.filter(c => c.get)
		return (obj, insertOnly) =>
			// value functions must be able to use other db during migrations, so call with our this
			Promise.all(valueCols.map(d => d.value.call(this, obj))).then(colVals =>
				// The json field is part of the colVals
				// eslint-disable-next-line promise/no-nesting
				this.db
					.run(insertOnly ? insertSql : updateSql, colVals)
					.then(result => {
						// Return what get(id) would return
						const newObj = new Item()
						Object.assign(newObj, obj)
						selectIdxs.forEach(({name, parse, i}) => {
							newObj[name] = parse ? parse(colVals[i]) : colVals[i]
						})
						if (newObj[this.idCol] == null) {
							// This can only happen for integer ids, so we use the last inserted rowid
							newObj[this.idCol] = result.lastID
						}
						return newObj
					})
			)
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
		} = options
		cols = cols || this.selectColNames
		let cursorColNames
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
			let cursorQ = `${cursorColNames[l]}${getDir(l)}?`
			const args = [vals[l]]
			for (let i = l - 1; i >= 0; i--) {
				cursorQ =
					`(${cursorColNames[i]}${getDir(i)}=?` +
					` AND (${cursorColNames[i]}!=? OR ${cursorQ}))`
				const val = vals[i]
				args.unshift(val, val)
			}

			where = {
				...where,
				[cursorQ]: args,
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
				if (val != null) {
					const col = this.columns[a]
					if (!col) {
						throw new Error(`Unknown column ${a}`)
					}
					if (col.where) {
						const {where, whereVal} = col
						let valid = true
						if (whereVal) {
							val = whereVal(val)
							if (Array.isArray(val)) {
								vals.push(...val)
							} else {
								valid = false
							}
						} else {
							vals.push(val)
						}
						if (valid) {
							conds.push(typeof where === 'function' ? where(val) : where)
						}
					} else {
						conds.push(`${col.sql}=?`)
						vals.push(val)
					}
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

		const whereQ =
			conds.length && `WHERE${conds.map(c => `(${c})`).join('AND')}`

		// note: if preparing, this can be replaced with LIMIT(?,?)
		// First is offset (can be 0) and second is limit (-1 for no limit)
		const limitQ = limit && `LIMIT ${Number(limit) || 10}`
		const offsetQ = offset && `OFFSET ${Number(offset) || 0}`

		if (join && joinVals && joinVals.length) {
			vals.unshift(...joinVals)
		}

		const q = [selectQ, join, whereQ, orderQ, limitQ, offsetQ]
			.filter(Boolean)
			.join(' ')
		return [q, vals, cursorColNames]
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

	// Alias - deprecated because of deprecated .find()
	findOne(attrs, options) {
		if (DEV)
			deprecated('findOneMethod', 'use .searchOne() instead of .findOne()')
		return this.searchOne(attrs, options)
	}

	// returns {items[], cursor}. If no cursor, you got all the results
	// cursor: pass previous cursor to get the next page
	// Note: To be able to query the previous page with a cursor, we need to invert the sort and then reverse the result rows
	search(attrs, {itemsOnly, ...options} = {}) {
		const [q, vals, cursorKeys] = this.makeSelect({
			attrs,
			noCursor: itemsOnly,
			...options,
		})
		return this.db.all(q, vals).then(rows => {
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
			return {items, cursor}
		})
	}

	// Alias - deprecated because it's easy to confuse with array.find()
	find(attrs, options) {
		if (DEV) deprecated('findMethod', 'use .search() instead of .find()')
		return this.search(attrs, options)
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

	max(colName, attrs, options) {
		const sql = this._colSql(colName)
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			cols: [`MAX(${sql}) AS max`],
		})
		return this.db.get(q, vals).then(row => row.max)
	}

	min(colName, attrs, options) {
		const sql = this._colSql(colName)
		const [q, vals] = this.makeSelect({
			attrs,
			...options,
			sort: undefined,
			limit: undefined,
			offset: undefined,
			noCursor: true,
			cols: [`MIN(${sql}) AS min`],
		})
		return this.db.get(q, vals).then(row => row.min)
	}

	all() {
		return this.db
			.all(`SELECT ${this.selectColsSql} FROM ${this.quoted}`)
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
				`
			SELECT ${this.selectColsSql} FROM ${this.quoted} WHERE ${where} = ?
		`,
				[id]
			)
			.then(this.toObj)
	}

	getAll(ids, colName = this.idCol) {
		const qs = ids.map(() => '?').join()
		const where = this.columns[colName].sql
		return this.db
			.all(
				`
			SELECT ${this.selectColsSql} FROM ${this.quoted} WHERE ${where} IN (${qs})
		`,
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
		const idSql = this.columns[this.idCol].sql
		return this.db
			.run(`UPDATE ${this.quoted} SET ${idSql} = ? WHERE ${idSql} = ?`, [
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
