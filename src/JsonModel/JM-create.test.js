import {DB, JsonModel, getModel, sharedSetup} from '../lib/_test-helpers'

test('create', () => {
	const m = getModel()
	expect(() => m.all()).not.toThrow()
	expect(m.db.store[m.name]).toBe(m)
})

test('create invalid', () => {
	const db = new DB()
	expect(() => new JsonModel()).toThrow()
	expect(() => new JsonModel({db})).toThrow()
	expect(() => new JsonModel({name: 'foo'})).toThrow()
})

test('derived set', async () => {
	let ran = false
	class Foo extends JsonModel {
		set(obj) {
			ran = true
			return super.set(obj)
		}
	}
	const db = new DB()
	const foo = new Foo({db, name: 'foo'})
	await foo.set({test: true})
	expect(ran).toBe(true)
})

test('id generation', async () => {
	const m = getModel({columns: {id: {value: o => o.foo}}})
	const idFn = m.columns.id.value.bind(m)
	expect(await idFn({})).toBeTruthy()
	expect(await idFn({id: 'hi'})).toBe('hi')
	expect(await idFn({foo: 'ho'})).toBe('ho')
	expect(await idFn({foo: 0})).toBe(0)
	expect(await idFn({foo: ''})).toBe('')
	expect(await idFn({foo: null})).toBeTruthy()
})

test('async id generation', async () => {
	const m = getModel({columns: {id: {value: async o => o.foo}}})
	const idFn = m.columns.id.value.bind(m)
	expect(await idFn({})).toBeTruthy()
	expect(await idFn({id: 'hi'})).toBe('hi')
	expect(await idFn({foo: 'ho'})).toBe('ho')
	expect(await idFn({foo: 0})).toBe(0)
	expect(await idFn({foo: ''})).toBe('')
	expect(await idFn({foo: null})).toBeTruthy()
})

test('id/col slugValue', async () => {
	const m = getModel({
		columns: {
			id: {slugValue: o => o.hi.slice(0, 3)},
			hi: {},
			other: {slugValue: o => o.hi.toUpperCase(), index: true, get: true},
		},
	})
	await m.set({hi: 'hello'})
	const o = await m.searchOne()
	expect(o).toEqual({id: 'hel', hi: 'hello', other: 'hello'})
	await m.set({hi: 'Hello'})
	const p = await m.searchOne({hi: 'Hello'})
	expect(p).toEqual({id: 'hel-2', hi: 'Hello', other: 'hello-2'})
	const q = await m.set({id: 'hel-2', hi: 'Hello', other: undefined})
	expect(q).toEqual({id: 'hel-2', hi: 'Hello', other: 'hello-2'})
})

const withObjs = sharedSetup(() => {
	const m = getModel()
	return Promise.all([
		m.set({id: 0, moop: 8}),
		m.set({id: '', moop: 9}),
		m.set({id: 'foobar', fluffy: true}),
		m.set({noId: true}),
	]).then(() => m)
})
test(
	'get falsy ids',
	withObjs(async m => {
		expect(await m.get(0)).toEqual({id: '0', moop: 8})
		expect(await m.get('')).toEqual({id: '', moop: 9})
	})
)

test(
	'get by id',
	withObjs(async m => {
		expect(await m.get('foobar')).toEqual({id: 'foobar', fluffy: true})
	})
)

test(
	'get w/ auto id',
	withObjs(async m => {
		const obj = {fluffier: true}
		const withId = await m.set(obj)
		const saved = await m.get(withId.id)
		expect(saved).toEqual(withId)
		expect(saved.fluffier).toBe(true)
	})
)

test(
	'get w/ null id',
	withObjs(async m => {
		await expect(m.get(null)).rejects.toThrow('No id')
		await expect(m.get(undefined)).rejects.toThrow('No id')
	})
)

test(
	'get w/ unknown column',
	withObjs(async m => {
		await expect(m.get(1, 'foo')).rejects.toThrow('column "foo"')
	})
)

test('get w/ other colName', async () => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, slug: {}},
	})
	await m.set({id: 0, slug: 10})
	expect(await m.get(10, 'slug')).toEqual({id: 0, slug: 10})
})

test('getAll', async () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			slug: {},
			objectId: {path: 'object.id'},
			no: {real: true, get: false, value: () => 5},
		},
	})
	await expect(m.getAll([], 'no')).rejects.toThrow('get:false')
	await Promise.all(
		[0, 1, 2, 3, 4].map(id => m.set({id, slug: id + 10, object: {id}}))
	)
	expect(await m.getAll([])).toEqual([])
	expect(await m.getAll([4])).toEqual([{id: 4, slug: 14, object: {id: 4}}])
	expect(await m.getAll([4, 'nope', 0])).toEqual([
		{id: 4, slug: 14, object: {id: 4}},
		undefined,
		{id: 0, slug: 10, object: {id: 0}},
	])
	expect(await m.getAll([10, 'nope', 12], 'slug')).toEqual([
		{id: 0, slug: 10, object: {id: 0}},
		undefined,
		{id: 2, slug: 12, object: {id: 2}},
	])
	expect(await m.getAll([2, 'nope', 4], 'objectId')).toEqual([
		{id: 2, slug: 12, object: {id: 2}},
		undefined,
		{id: 4, slug: 14, object: {id: 4}},
	])
})

test('all', async () => {
	const m = getModel()
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const saved = await m.all()
	expect(saved).toHaveLength(5)
	expect(saved.some(r => r.id === '4')).toBe(true)
	expect(saved.some(r => r.id === '1')).toBe(true)
})

test('delete undefined', async () => {
	const m = getModel()
	const p = m.remove()
	await expect(p).resolves.not.toThrow()
})

test('delete', async () => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	await m.set({id: 123})
	await expect(m.remove(123)).resolves.not.toThrow()
	expect(await m.get(123)).toBeFalsy()
	await m.set({id: 234})
	await expect(m.remove({id: 234})).resolves.not.toThrow()
	expect(await m.get(234)).toBeFalsy()
})

test('count', async () => {
	const m = getModel()
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const count = await m.count(null, {where: {'id > 2': []}})
	expect(count).toBe(2)
})

test('idCol', async () => {
	const m = getModel({idCol: 'v', columns: {foo: {}}})
	await Promise.all([0, 1, 2, 3, 4].map(v => m.set({v})))
	expect(await m.get(1)).toEqual({v: '1'})
	expect(await m.get(1)).toEqual({v: '1'})
	const n = await m.set({foo: 342})
	expect(n.v).toBeTruthy()
	m.set({v: n.v, foo: 342})
	const n2 = await m.search({foo: 342})
	expect(n2.items).toHaveLength(1)
	expect(await m.get(n.v)).toBeTruthy()
	await m.remove(n.v)
	expect(await m.get(n.v)).toBeFalsy()
	expect(m.makeSelect({limit: 2})).toEqual([
		'SELECT tbl."v" AS _i,tbl."json" AS _j FROM "testing" tbl ORDER BY _i LIMIT 2',
		[],
		['_i'],
		'SELECT COUNT(*) as t from ( SELECT tbl."v" AS _i,tbl."json" AS _j FROM "testing" tbl )',
		[],
	])
})

describe('each', () => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	beforeAll(async () => {
		await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	})
	const callEach = async (...args) => {
		const stats = {count: 0, total: 0, maxI: 0, maxConcurrent: 0}
		let concurrent = 0,
			running = true
		await m.each(...args, async (row, i) => {
			if (!running) throw new Error('got called after each returned')
			concurrent++
			if (stats.maxConcurrent < concurrent) stats.maxConcurrent = concurrent
			stats.count++
			stats.total += row.id
			if (stats.maxI < i) stats.maxI = i
			await new Promise(r => setTimeout(r, Math.random() * 10))
			concurrent--
		})
		running = false
		return stats
	}
	test('call', async () => {
		await expect(m.each()).rejects.toThrow('requires function')
	})
	test('uses noTotal', async () => {
		const n = getModel()
		n.search = jest.fn(() => ({items: []}))
		await n.each(() => {})
		expect(n.search).toHaveBeenCalledTimes(1)
		expect(n.search).toHaveBeenCalledWith(
			undefined,
			expect.objectContaining({noTotal: true, limit: expect.any(Number)})
		)
	})
	test('no query', async () => {
		const stats = await callEach()
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 5,
			  "maxConcurrent": 5,
			  "maxI": 4,
			  "total": 10,
			}
		`)
	})
	test('attr', async () => {
		const stats = await callEach({id: 3})
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 1,
			  "maxConcurrent": 1,
			  "maxI": 0,
			  "total": 3,
			}
		`)
	})
	test('where', async () => {
		const stats = await callEach({}, {where: {'id<3': []}})
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 3,
			  "maxConcurrent": 3,
			  "maxI": 2,
			  "total": 3,
			}
		`)
	})
	test('concurrent', async () => {
		const stats = await callEach({}, {concurrent: 2})
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 5,
			  "maxConcurrent": 2,
			  "maxI": 4,
			  "total": 10,
			}
		`)
	})
	test('batchSize', async () => {
		const stats = await callEach({}, {batchSize: 3})
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 5,
			  "maxConcurrent": 3,
			  "maxI": 4,
			  "total": 10,
			}
		`)
	})
	test('limit', async () => {
		const stats = await callEach({}, {limit: 1})
		// ! in the next major release, count will be 2
		expect(stats).toMatchInlineSnapshot(`
			{
			  "count": 5,
			  "maxConcurrent": 1,
			  "maxI": 4,
			  "total": 10,
			}
		`)
	})
})

describe('id column types', () => {
	test('integer', async () => {
		const m = getModel({columns: {id: {type: 'INTEGER'}}})
		const layout = await m.db.all(`pragma table_info(${m.quoted})`)
		expect(layout.find(col => col.name === 'id')).toEqual(
			expect.objectContaining({pk: 1, type: 'INTEGER', notnull: 1})
		)
	})

	test('other without keepRowId', async () => {
		const m = getModel({columns: {id: {type: 'TEXT'}}, keepRowId: false})
		const layout = await m.db.all(`pragma table_info(${m.quoted})`)
		expect(layout.find(col => col.name === 'id')).toEqual(
			expect.objectContaining({pk: 1, type: 'TEXT', notnull: 1})
		)
	})

	test('other with keepRowId', async () => {
		const m = getModel({columns: {id: {type: 'TEXT'}}, keepRowId: true})
		const layout = await m.db.all(`pragma table_info(${m.quoted})`)
		expect(layout.find(col => col.name === 'id')).toEqual(
			expect.objectContaining({pk: 0, type: 'TEXT', notnull: 1})
		)
		expect(await m.db.get(`pragma index_info("${m.name}_id")`)).toBeTruthy()
	})
})
