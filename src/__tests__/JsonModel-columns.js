import expect from 'expect'
import {getModel, sharedSetup} from './_helpers'

const indexesSql = `
	SELECT m.tbl_name || '.' || ifNull(ii.name, m.name) AS col, m.sql
	FROM sqlite_master AS m,
				pragma_index_info(m.name) AS ii
	WHERE m.type='index'
	ORDER BY 1;
`

const withCols = sharedSetup(async () => {
	const m = getModel({
		columns: {
			foo1: {index: 'SPARSE'},
			foo2: {
				type: 'INTEGER',
				value: o => o.foo1 + 1,
				get: false,
				alias: 'foo2',
			},
			foo3: {
				value: o => o.notExists,
				index: 'ALL',
				unique: true,
			},
			fooGet: {real: true, value: () => 3},
		},
	})
	await m.set({id: 'meep', foo1: 5})
	return m
})
test(
	'columns create',
	withCols(async m => {
		expect(m.columnArr).toMatchSnapshot()
		const row = await m.db.get(`SELECT json, foo2 FROM ${m.name}`)
		expect(row).toEqual({json: `{"foo1":5}`, foo2: 6})
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
		const indexes = await m.db.all(indexesSql)
		expect(indexes.some(i => i.col.includes('foo3'))).toBe(true)
		expect(indexes.every(i => !i.col.includes('foo2'))).toBe(true)
	})
)

test('default w/ value()', async () => {
	const m = getModel({columns: {v: {real: true, default: 5}}})
	await m.set({id: 1})
	expect(await m.db.all(`select * from ${m.name}`)).toEqual([
		{id: '1', json: null, v: 5},
	])
	expect(m.columns.v.ignoreNull).toBe(false)
})

test('default w/ sql', async () => {
	const m = getModel({columns: {v: {sql: 'hex(id)', default: 0}}})
	expect(m.makeSelect({attrs: {v: 5}, sort: {v: -1}, cols: ['v']})).toEqual([
		'SELECT ifNull(hex(id),0) AS _0 FROM "testing" tbl WHERE(ifNull(hex(id),0)=?) ORDER BY _0 DESC',
		[5],
		undefined,
		'SELECT COUNT(*) as t from ( SELECT ifNull(hex(id),0) AS _0 FROM "testing" tbl WHERE(ifNull(hex(id),0)=?) )',
		[5],
	])
	expect(m.columns.v.ignoreNull).toBe(false)
})

test('value w type JSON', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			v: {type: 'JSON'},
		},
	})
	await m.set({v: {whee: true}})
	await m.set({v: 5})
	await m.set({other: true})
	expect(await m.db.all('SELECT * FROM testing')).toEqual([
		{id: 1, json: null, v: '{"whee":true}'},
		{id: 2, json: null, v: 5},
		{id: 3, json: '{"other":true}', v: null},
	])
	expect(await m.all()).toEqual([
		{id: 1, v: {whee: true}},
		{id: 2, v: 5},
		{id: 3, other: true},
	])
})

test('required', async () => {
	const m = getModel({
		columns: {
			foo: {value: o => o.foo, get: true, required: true},
			bar: {
				async value() {
					return this.count()
				},
				get: true,
				required: true,
			},
		},
	})
	expect(m.columns.foo).toHaveProperty('ignoreNull', false)
	await expect(m.set({})).rejects.toThrow('foo')
	await expect(m.set({foo: null})).rejects.toThrow('foo')
	await expect(m.set({foo: 0})).resolves.toHaveProperty('foo', 0)
	await expect(m.set({foo: ''})).resolves.toHaveProperty('foo', '')
	const obj = await m.set({foo: 'hi'})
	expect(obj).toHaveProperty('foo', 'hi')
	expect(obj).toHaveProperty('bar', 2)
})

test('nested JSON', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			c: {type: 'JSON', path: 'a.b.c'},
			a: {type: 'JSON'},
			b: {type: 'JSON', path: 'a.b'},
		},
	})
	await expect(m.set({a: {b: {c: 3}}})).resolves.toEqual({
		id: 1,
		a: {b: {c: 3}},
	})
	await expect(m.get(1)).resolves.toEqual({id: 1, a: {b: {c: 3}}})
	await expect(m.db.get('select * from testing')).resolves.toEqual({
		a: '{}',
		b: '{}',
		c: 3,
		id: 1,
		json: null,
	})
})

test('path in json column', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			b: {path: 'a.b'},
			a: {type: 'JSON'},
			c: {real: true},
			d: {path: 'c.d'},
			e: {type: 'JSON', get: false, parse: null},
			f: {path: 'e.f'},
		},
	})
	expect(m.columns.b.jsonCol).toBe('a')
	expect(m.columns.d.jsonCol).toBe('json')
	expect(m.columns.f.jsonCol).toBe('json')
	await m.set({a: {b: 4}})
	await expect(m.searchOne({b: 4})).resolves.toHaveProperty('id', 1)
	await expect(m.get(1)).resolves.toEqual({id: 1, a: {b: 4}})
	await expect(m.db.get('select * from testing')).resolves.toEqual({
		id: 1,
		a: '{"b":4}',
		c: null,
		e: null,
		json: null,
	})
})

test('where/whereVal', () => {
	const m = getModel({
		columns: {
			s: {where: 's<?'},
			f: {where: v => `${v}=?`},
			v: {whereVal: v => [v * 2]},
			w: {where: 'hi', whereVal: () => []},
			o: {whereVal: () => false},
		},
	})
	expect(
		m.makeSelect({attrs: {s: 1, f: 2, v: 3, w: 4, o: 5}}).slice(0, 2)
	).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(s<?)AND(2=?)AND(json_extract(tbl."json",\'$.v\')=?)AND(hi)',
		[1, 2, 6],
	])
})

test('where(val, origVal)', () => {
	const m = getModel({
		columns: {
			a: {where: (v, o) => `${v}|${o}`, whereVal: v => [v * 2]},
		},
	})
	expect(m.makeSelect({attrs: {a: 1}}).slice(0, 2)).toEqual([
		'SELECT tbl."id" AS _i,tbl."json" AS _j FROM "testing" tbl WHERE(2|1)',
		[2],
	])
})

test('where string', () => {
	expect(() =>
		getModel({
			columns: {
				s: {where: 'noplaceholder'},
			},
		})
	).toThrow('where')
})

test('whereVal truthy not array', () => {
	const m = getModel({
		columns: {
			s: {whereVal: () => true},
		},
	})
	expect(() => m.makeSelect({attrs: {s: 1}})).toThrow('whereVal')
})
