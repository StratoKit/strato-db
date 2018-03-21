import expect from 'expect'
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
	withCols(async m => {
		const row = await m.db.get(`SELECT json, foo2, foo3 FROM ${m.name}`)
		expect(row).toEqual({json: `{"foo1":5}`, foo2: 6, foo3: null})
	})
)
test(
	'columns order',
	withCols(async m => {
		// id and json are calculated last
		const l = m.columnArr.length
		expect(m.columnArr[l - 2].name).toBe('id')
		expect(m.columnArr[l - 1].name).toBe('json')
	})
)
test(
	'columns get',
	withCols(async m => {
		// columns don't automatically change the original object
		const saved = await m.get('meep')
		expect(saved.foo2).toBeFalsy()
		expect(saved.fooGet).toBe(3)
		saved.id = 'meep2'
		await m.set(saved)
		const row = await m.db.get`SELECT * FROM ${m.name}ID WHERE id = ${saved.id}`
		const json = JSON.parse(row.json)
		// JSON does not include get columns
		expect(json.fooGet).toBeFalsy()
		expect(json.id).toBeFalsy()
		expect(json.foo1).toBe(5)
	})
)
test(
	'columns indexes',
	withCols(async m => {
		// Indexes are created
		const indexes = await m.db.all(
			`SELECT * FROM SQLITE_MASTER WHERE type = 'index'`
		)
		expect(indexes.some(i => i.name.includes('foo3'))).toBe(true)
		expect(indexes.every(i => !i.name.includes('foo2'))).toBe(true)
	})
)

test('jsonPath/sql and get', () => {
	expect(() =>
		getModel({columns: {foo: {jsonPath: 'foo', get: true}}})
	).toThrow()
	expect(() => getModel({columns: {foo: {sql: '1 + 1', get: true}}})).toThrow()
})
