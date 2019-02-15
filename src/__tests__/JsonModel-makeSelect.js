import expect from 'expect'
import {getModel} from './_helpers'

test('makeSelect basic', () => {
	const m = getModel({
		columns: {
			foo: {real: true},
			bar: {},
			meep: {},
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
		'SELECT json_extract(tbl."json",\'$.meep\') AS _2,name,date,tbl."id" AS _i FROM "testing" tbl WHERE(tbl."foo"=?)AND(json_extract(tbl."json",\'$.bar\')=?) ORDER BY name,date DESC,_i LIMIT 20 OFFSET 5'
	)
	expect(v).toEqual([0, 3])
	expect(s).toEqual(['name', 'date', '_i'])
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
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(foo < ?)AND(json_extract(json, \'$.bar\') = ?)AND(json is not null)'
	)
	expect(v).toEqual([5, 8])
})

test('makeSelect limit 1 w/ sort', () => {
	const m = getModel()
	const [q] = m.makeSelect({limit: 1, sort: {bar: 1}, noCursor: true})
	expect(q).toEqual(
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl ORDER BY bar LIMIT 1'
	)
})

test('makeSelect sort w/ path', () => {
	const m = getModel({columns: {foo: {}}})
	const [q] = m.makeSelect({limit: 1, sort: {foo: -1}})
	expect(q).toEqual(
		'SELECT tbl."id" AS _i,tbl."json" AS _j,json_extract(tbl."json",\'$.foo\') AS _0 FROM "testing" tbl ORDER BY _0 DESC,_i LIMIT 1'
	)
})

test('makeSelect isArray', () => {
	const m = getModel({columns: {foo: {isArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: 'meep'}})
	expect(q).toEqual(
		`SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(? IN (SELECT value FROM json_each(tbl."json",'$.foo')))`
	)
})

test('makeSelect textSearch', () => {
	const m = getModel({columns: {foo: {textSearch: true}}})
	expect(m.makeSelect({attrs: {foo: 'meep'}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",\'$.foo\') LIKE ?)',
		['%meep%'],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",\'$.foo\') LIKE ?) )',
		['%meep%'],
	])
})

test('makeSelect textSearch falsy', () => {
	const m = getModel({columns: {foo: {textSearch: true}}})
	expect(m.makeSelect({attrs: {foo: ''}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl',
		[],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl )',
		[],
	])
	expect(m.makeSelect({attrs: {foo: null}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl',
		[],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl )',
		[],
	])
	expect(m.makeSelect({attrs: {foo: 0}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",\'$.foo\') LIKE ?)',
		['%0%'],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",\'$.foo\') LIKE ?) )',
		['%0%'],
	])
})

test('makeSelect isAnyOfArray', () => {
	const m = getModel({columns: {foo: {isAnyOfArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl."json",'$.foo') j WHERE j.value IN (SELECT value FROM json_each(?))))`
	)
})

test('makeSelect in', () => {
	const m = getModel({
		columns: {foo: {in: true}, bar: {real: true, in: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT tbl."bar" AS _1,tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",'$.foo') IN (SELECT value FROM json_each(?)))`
	)
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(
		'SELECT tbl."bar" AS _1,tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl'
	)
})

test('makeSelect in w/ path', () => {
	const m = getModel({columns: {foo: {in: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(json_extract(tbl."json",'$.foo') IN (SELECT value FROM json_each(?)))`
	)
})

test('makeSelect in + isArray = isAnyOfArray', () => {
	const m = getModel({
		columns: {foo: {in: true, isArray: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl."json",'$.foo') j WHERE j.value IN (SELECT value FROM json_each(?))))`
	)
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl'
	)
})

test('makeSelect inAll', () => {
	const m = getModel({
		columns: {foo: {inAll: true, isArray: true}},
	})
	const [q, v] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	expect(q).toEqual(
		`SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE j.value NOT IN (SELECT value FROM json_each(tbl."json",'$.foo'))))`
	)
	expect(v).toEqual([`["meep","moop"]`])
	const [q2] = m.makeSelect({attrs: {foo: []}})
	expect(q2).toEqual(
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl'
	)
})

test('inAll works', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			foo: {inAll: true, isArray: true},
		},
	})
	await m.set({foo: [1, 2, 5]})
	await m.set({foo: [1, 2, 3, 4]})
	await m.set({foo: [1, 2, 4, 5]})
	expect(await m.searchAll({foo: []})).toHaveLength(3)
	expect(await m.searchAll({foo: [1, 2]})).toHaveLength(3)
	expect(await m.searchAll({foo: [5]})).toHaveLength(2)
	expect(await m.searchAll({foo: [4, 2]})).toHaveLength(2)
	expect(await m.searchAll({foo: [4, 5]})).toEqual([{foo: [1, 2, 4, 5], id: 3}])
})

test('col.where', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'foo = ?'}},
	})
	expect(m.makeSelect({attrs: {foo: 'moop'}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(foo = ?)',
		['moop'],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(foo = ?) )',
		['moop'],
	])
})

test('col.where fn', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: v => v.length}},
	})
	expect(m.makeSelect({attrs: {id: 4, foo: '123'}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?)AND(3)',
		[4, '123'],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?)AND(3) )',
		[4, '123'],
	])
})

test('col.whereVal fn', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'ohai', whereVal: v => [v.join()]}},
	})
	expect(m.makeSelect({attrs: {id: 5, foo: ['meep', 'moop']}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?)AND(ohai)',
		[5, 'meep,moop'],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?)AND(ohai) )',
		[5, 'meep,moop'],
	])
})

test('col.whereVal fn falsy', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'ohai', whereVal: () => 0}},
	})
	expect(m.makeSelect({attrs: {id: 5, foo: ['meep', 'moop']}})).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?)',
		[5],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(tbl."id"=?) )',
		[5],
	])
})

test('min', async () => {
	const m = getModel({columns: {v: {}}})
	expect(await m.min('v')).toBe(null)
	await m.set({v: 5})
	expect(await m.min('v')).toBe(5)
	await m.set({v: '3'})
	expect(await m.min('v')).toBe(3)
	await m.set({v: 'blah'})
	expect(await m.min('v')).toBe(0)
})

test('max', async () => {
	const m = getModel({columns: {v: {}}})
	expect(await m.max('v')).toBe(null)
	await m.set({v: 'blah'})
	expect(await m.max('v')).toBe(0)
	await m.set({v: 5})
	expect(await m.max('v')).toBe(5)
	await m.set({v: '7'})
	expect(await m.max('v')).toBe(7)
})

test('avg', async () => {
	const m = getModel({columns: {v: {}}})
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
	const m = getModel({columns: {v: {}}})
	expect(await m.sum('v')).toBe(null)
	await m.set({v: 'blah'})
	expect(await m.sum('v')).toBe(0)
	await m.set({v: 5})
	await m.set({v: '8'})
	expect(await m.sum('v')).toBe(13)
})
