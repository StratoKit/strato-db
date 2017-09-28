import test from 'ava'
import {getModel, sharedSetup} from './_helpers'

const withCols = sharedSetup(async () => {
	const m = getModel({
		columns: {
			foo1: {jsonPath: 'foo1', index: true},
			foo2: {value: o => o.foo1 + 1},
			foo3: {
				value: o => o.notExists,
				index: true,
				unique: true,
				ignoreNull: true,
			},
			fooGet: {value: () => 3, get: true},
		},
		multiIndexes: {},
	})
	await m.set({id: 'meep', foo1: 5})
	return m
})
test(
	'columns create',
	withCols(async (m, t) => {
		const row = await m.db.get(`SELECT json, foo2, foo3 FROM ${m.name}`)
		t.deepEqual(row, {json: `{"foo1":5}`, foo2: 6, foo3: null})
	})
)
test(
	'columns order',
	withCols(async (m, t) => {
		// id and json are calculated last
		const l = m.columnArr.length
		t.is(m.columnArr[l - 2].name, 'id')
		t.is(m.columnArr[l - 1].name, 'json')
	})
)
test(
	'columns get',
	withCols(async (m, t) => {
		// columns don't automatically change the original object
		const saved = await m.get('meep')
		t.falsy(saved.foo2)
		t.is(saved.fooGet, 3)
		saved.id = 'meep2'
		await m.set(saved)
		const row = await m.db.get`SELECT * FROM ${m.name}ID WHERE id = ${saved.id}`
		const json = JSON.parse(row.json)
		// JSON does not include get columns
		t.falsy(json.fooGet)
		t.falsy(json.id)
		t.is(json.foo1, 5)
	})
)
test(
	'columns indexes',
	withCols(async (m, t) => {
		// Indexes are created
		const indexes = await m.db.all(
			`SELECT * FROM SQLITE_MASTER WHERE type = 'index'`
		)
		t.true(indexes.some(i => i.name.includes('foo3')))
		t.true(indexes.every(i => !i.name.includes('foo2')))
	})
)

test('jsonPath/sql and get', t => {
	t.throws(() => getModel({columns: {foo: {jsonPath: 'foo', get: true}}}))
	t.throws(() => getModel({columns: {foo: {sql: '1 + 1', get: true}}}))
})
