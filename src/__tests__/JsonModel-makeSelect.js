import expect from 'expect'
import {getModel} from './_helpers'

test('makeSelect basic', () => {
	const m = getModel({
		columns: {
			foo: {value: o => o.foo.toString()},
			bar: {jsonPath: 'bar'},
			meep: {jsonPath: 'meep'},
		},
	})
	const [q, v, s] = m.makeSelect({
		attrs: {foo: 0, bar: 3, meep: undefined, moop: null},
		limit: 20,
		offset: 5,
		cols: ['meep'],
		sort: {name: 1, date: -2},
	})
	expect(q).toEqual(
		'SELECT json_extract(json, \'$.meep\') AS _2,name,date,"id" AS _3 FROM "testing" tbl WHERE("foo"=?)AND(json_extract(json, \'$.bar\')=?) ORDER BY name,date DESC,_3 LIMIT 20 OFFSET 5'
	)
	expect(v).toEqual([0, 3])
	expect(s).toEqual(['name', 'date', '_3'])
})

test('makeSelect where', () => {
	const m = getModel()
	const [q, v] = m.makeSelect({
		where: {
			'foo < ?': [5],
			"json_extract(json, '$.bar') = ?": [8],
			'json is not null': [],
			'ignore me': null,
		},
	})
	expect(q).toEqual(
		`SELECT "id" AS _0,"json" AS _1 FROM "testing" tbl WHERE(foo < ?)AND(json_extract(json, '$.bar') = ?)AND(json is not null)`
	)
	expect(v).toEqual([5, 8])
})

test('makeSelect limit 1 w/ sort', () => {
	const m = getModel()
	const [q] = m.makeSelect({limit: 1, sort: {bar: 1}, noCursor: true})
	expect(q).toEqual(
		`SELECT "id" AS _0,"json" AS _1 FROM "testing" tbl ORDER BY bar LIMIT 1`
	)
})

test('makeSelect sort w/ jsonPath', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo'}}})
	const [q] = m.makeSelect({limit: 1, sort: {foo: -1}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2,json_extract(json, '$.foo') AS _0 FROM "testing" tbl ORDER BY _0 DESC,_1 LIMIT 1`
	)
})

test('makeSelect isArray', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', isArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: 'meep'}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value = ?))`
	)
})

test('makeSelect textSearch', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', textSearch: true}}})
	expect(m.makeSelect({attrs: {foo: 'meep'}})).toEqual([
		'SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, \'$.foo\') LIKE ?)',
		['%meep%'],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE(json_extract(json, \'$.foo\') LIKE ?)',
		['%meep%'],
	])
})

test('makeSelect textSearch falsy', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', textSearch: true}}})
	expect(m.makeSelect({attrs: {foo: ''}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`,
		[],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl',
		[],
	])
	expect(m.makeSelect({attrs: {foo: null}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`,
		[],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl',
		[],
	])
	expect(m.makeSelect({attrs: {foo: 0}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, '$.foo') LIKE ?)`,
		['%0%'],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE(json_extract(json, \'$.foo\') LIKE ?)',
		['%0%'],
	])
})

test('makeSelect isAnyOfArray', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', isAnyOfArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value IN (?,?)))`
	)
})

test('makeSelect in', () => {
	const m = getModel({
		columns: {foo: {index: true, value: o => o.foo.toString(), in: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE("foo" IN (?,?))`
	)
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`)
})

test('makeSelect in w/ jsonPath', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', in: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, '$.foo') IN (?,?))`
	)
})

test('makeSelect in + isArray = isAnyOfArray', () => {
	const m = getModel({
		columns: {foo: {jsonPath: 'foo', in: true, isArray: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value IN (?,?)))`
	)
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`)
})

test('makeSelect inAll', () => {
	const m = getModel({
		columns: {foo: {jsonPath: 'foo', inAll: true, isArray: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		'SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(? IN (SELECT COUNT(*) FROM (SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value IN (?,?,?))))'
	)
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`)
})

test('inAll works', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			foo: {jsonPath: 'foo', inAll: true, isArray: true},
		},
	})
	await m.set({foo: [1, 2, 3]})
	await m.set({foo: [1, 2, 3, 4]})
	await m.set({foo: [1, 2, 3, 4, 5]})
	expect(await m.searchAll({foo: []})).toHaveLength(3)
	expect(await m.searchAll({foo: [1, 2]})).toHaveLength(3)
	expect(await m.searchAll({foo: [2, 3, 4]})).toHaveLength(2)
	expect(await m.searchAll({foo: [2, 3, 4]})).toHaveLength(2)
	expect(await m.searchAll({foo: [2, 3, 4, 5]})).toEqual([
		{foo: [1, 2, 3, 4, 5], id: 3},
	])
})

test('col.where', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'foo = ?'}},
	})
	expect(m.makeSelect({attrs: {foo: 'moop'}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(foo = ?)`,
		['moop'],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE(foo = ?)',
		['moop'],
	])
})

test('col.where fn', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: v => v.length}},
	})
	expect(m.makeSelect({attrs: {id: 4, foo: '123'}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE("id"=?)AND(3)`,
		[4, '123'],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE("id"=?)AND(3)',
		[4, '123'],
	])
})

test('col.whereVal fn', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'ohai', whereVal: v => [v.join()]}},
	})
	expect(m.makeSelect({attrs: {id: 5, foo: ['meep', 'moop']}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE("id"=?)AND(ohai)`,
		[5, 'meep,moop'],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE("id"=?)AND(ohai)',
		[5, 'meep,moop'],
	])
})

test('col.whereVal fn falsy', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'ohai', whereVal: () => 0}},
	})
	expect(m.makeSelect({attrs: {id: 5, foo: ['meep', 'moop']}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE("id"=?)`,
		[5],
		undefined,
		'SELECT COUNT(*) as t from "testing" tbl WHERE("id"=?)',
		[5],
	])
})

test('min', async () => {
	const m = getModel({columns: {v: {jsonPath: 'v'}}})
	expect(await m.min('v')).toBe(null)
	await m.set({v: 5})
	expect(await m.min('v')).toBe(5)
	await m.set({v: '3'})
	expect(await m.min('v')).toBe(3)
	await m.set({v: 'blah'})
	expect(await m.min('v')).toBe(0)
})

test('max', async () => {
	const m = getModel({columns: {v: {jsonPath: 'v'}}})
	expect(await m.max('v')).toBe(null)
	await m.set({v: 'blah'})
	expect(await m.max('v')).toBe(0)
	await m.set({v: 5})
	expect(await m.max('v')).toBe(5)
	await m.set({v: '7'})
	expect(await m.max('v')).toBe(7)
})

test('avg', async () => {
	const m = getModel({columns: {v: {jsonPath: 'v'}}})
	expect(await m.avg('v')).toBe(null)
	await m.set({v: 'blah'})
	expect(await m.avg('v')).toBe(0)
	await m.set({v: 5})
	await m.set({v: '10'})
	expect(await m.avg('v')).toBe(5)
	expect(
		await m.avg('v', null, {
			where: {'CAST(json_extract(json,"$.v") as NUMERIC)>0': []},
		})
	).toBe(7.5)
})

test('sum', async () => {
	const m = getModel({columns: {v: {jsonPath: 'v'}}})
	expect(await m.sum('v')).toBe(null)
	await m.set({v: 'blah'})
	expect(await m.sum('v')).toBe(0)
	await m.set({v: 5})
	await m.set({v: '8'})
	expect(await m.sum('v')).toBe(13)
})
