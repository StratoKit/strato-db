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
		'SELECT json_extract(json, \'$.meep\') AS _2,name,date,"id" AS _3 FROM "testing" tbl WHERE("foo"=?)AND(json_extract(json, \'$.bar\')=?) ORDER BY name,date DESC,"id" LIMIT 20 OFFSET 5'
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
		`SELECT "id" AS _1,"json" AS _2,json_extract(json, '$.foo') AS _0 FROM "testing" tbl ORDER BY json_extract(json, '$.foo') DESC,"id" LIMIT 1`
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
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, '$.foo') LIKE ?)`,
		['%meep%'],
		undefined,
	])
})

test('makeSelect textSearch falsy', () => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', textSearch: true}}})
	expect(m.makeSelect({attrs: {foo: ''}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`,
		[],
		undefined,
	])
	expect(m.makeSelect({attrs: {foo: null}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl`,
		[],
		undefined,
	])
	expect(m.makeSelect({attrs: {foo: 0}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, '$.foo') LIKE ?)`,
		['%0%'],
		undefined,
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
})

test('col.where', () => {
	const m = getModel({
		columns: {foo: {sql: 'foo', where: 'foo = ?'}},
	})
	expect(m.makeSelect({attrs: {foo: 'moop'}})).toEqual([
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(foo = ?)`,
		['moop'],
		undefined,
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
	])
})
