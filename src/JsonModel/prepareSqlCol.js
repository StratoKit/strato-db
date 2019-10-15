import {sql} from '../DB'

export const byPathLength = (a, b) => a.parts.length - b.parts.length
export const byPathLengthDesc = (a, b) => b.parts.length - a.parts.length

const stringifyJson = JSON.stringify
export const stringifyJsonObject = obj => {
	const json = JSON.stringify(obj)
	return json === '{}' ? null : json
}

export const parseJson = v => (v == null ? v : JSON.parse(v))
const parseJsonObject = v => (v == null ? {} : JSON.parse(v))

const arrayToJson = v => (v && v.length ? [JSON.stringify(v)] : false)

// Note: avoid where functions; that way, queries can be reused for different args
// eslint-disable-next-line complexity
export const prepareSqlCol = col => {
	if (col.type === 'JSON') {
		if (col.stringify === undefined)
			col.stringify = col.alwaysObject ? stringifyJsonObject : stringifyJson
		if (col.parse === undefined)
			col.parse = col.alwaysObject ? parseJsonObject : parseJson
	} else if (col.alwaysObject)
		throw new TypeError(`${name}: .alwaysObject only applies to JSON type`)
	if (col.falsyBool && !col.where) {
		col.where = (_, v) => (v ? `${col.sql} IS NOT NULL` : `${col.sql} IS NULL`)
		col.whereVal = () => []
	}
	if (!col.sql) {
		col.sql = col.real
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
		const eachSql = `json_each(${
			col.real
				? `tbl.${col.quoted}`
				: `tbl.${sql.quoteId(col.jsonCol)},'$.${col.jsonPath}'`
		})`
		if (col.in) {
			col.where = `EXISTS(SELECT 1 FROM ${eachSql} j WHERE j.value IN (SELECT value FROM json_each(?)))`
			col.whereVal = arrayToJson
		} else if (col.inAll) {
			col.where = `NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE j.value NOT IN (SELECT value FROM ${eachSql}))`
			col.whereVal = arrayToJson
		} else {
			col.where = `? IN (SELECT value FROM ${eachSql})`
		}
	} else if (col.in) {
		if (col.where || col.whereVal)
			throw new TypeError(`${name}: cannot mix .in and where/whereVal`)
		if (col.textSearch)
			throw new TypeError(`${name}: Only one of in/textSearch allowed`)
		col.where = `${col.sql} IN (SELECT value FROM json_each(?))`
		col.whereVal = arrayToJson
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
			`${col.name}: .where "${col.where}" should include a ? when not passing .whereVal`
		)
	if (!col.where) col.where = `${col.sql}=?`
}
