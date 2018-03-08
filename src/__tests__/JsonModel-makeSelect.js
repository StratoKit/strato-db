import test from 'ava'
import {getModel} from './_helpers'

test('makeSelect basic', t => {
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
	t.deepEqual(
		q,
		'SELECT json_extract(json, \'$.meep\') AS _2,name,date,"id" AS _3 FROM "testing" tbl WHERE("foo"=?)AND(json_extract(json, \'$.bar\')=?) ORDER BY name,date DESC,"id" LIMIT 20 OFFSET 5'
	)
	t.deepEqual(v, [0, 3])
	t.deepEqual(s, ['name', 'date', '_3'])
})

test('makeSelect where', t => {
	const m = getModel()
	const [q, v] = m.makeSelect({
		where: {
			'foo < ?': [5],
			"json_extract(json, '$.bar') = ?": [8],
			'json is not null': [],
			'ignore me': null,
		},
	})
	t.deepEqual(
		q,
		`SELECT "id" AS _0,"json" AS _1 FROM "testing" tbl WHERE(foo < ?)AND(json_extract(json, '$.bar') = ?)AND(json is not null)`
	)
	t.deepEqual(v, [5, 8])
})

test('makeSelect limit 1 w/ sort', t => {
	const m = getModel()
	const [q] = m.makeSelect({limit: 1, sort: {bar: 1}, noCursor: true})
	t.deepEqual(
		q,
		`SELECT "id" AS _0,"json" AS _1 FROM "testing" tbl ORDER BY bar LIMIT 1`
	)
})

test('makeSelect sort w/ jsonPath', t => {
	const m = getModel({columns: {foo: {jsonPath: 'foo'}}})
	const [q] = m.makeSelect({limit: 1, sort: {foo: -1}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2,json_extract(json, '$.foo') AS _0 FROM "testing" tbl ORDER BY json_extract(json, '$.foo') DESC,"id" LIMIT 1`
	)
})

test('makeSelect isArray', t => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', isArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: 'meep'}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value = ?))`
	)
})

test('makeSelect isAnyOfArray', t => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', isAnyOfArray: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value IN (?,?)))`
	)
})

test('makeSelect in', t => {
	const m = getModel({
		columns: {foo: {index: true, value: o => o.foo.toString(), in: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE("foo" IN (?,?))`
	)
})

test('makeSelect in w/ jsonPath', t => {
	const m = getModel({columns: {foo: {jsonPath: 'foo', in: true}}})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(json_extract(json, '$.foo') IN (?,?))`
	)
})

test('makeSelect in + isArray = isAnyOfArray', t => {
	const m = getModel({
		columns: {foo: {jsonPath: 'foo', in: true, isArray: true}},
	})
	const [q] = m.makeSelect({attrs: {foo: ['meep', 'moop']}})
	t.deepEqual(
		q,
		`SELECT "id" AS _1,"json" AS _2 FROM "testing" tbl WHERE(EXISTS(SELECT 1 FROM json_each(tbl.json, "$.foo") j WHERE j.value IN (?,?)))`
	)
})
