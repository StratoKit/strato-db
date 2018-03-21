import expect from 'expect'
import {DB, JsonModel, getModel, sharedSetup} from './_helpers'

test('create', () => {
	const m = getModel()
	expect(() => m.all()).not.toThrow()
	expect(m.db.models[m.name]).toBe(m)
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

test('set with id', async () => {
	const m = getModel()
	const obj = {id: 'foobar', fluffy: true}
	const set = await m.set(obj)
	const saved = await m.get(set.id)
	expect(saved).toEqual(obj)
	expect(saved).toEqual(set)
})

test('set with falsy id, BLOB type', async () => {
	const m = getModel({columns: {id: {type: 'BLOB'}}})
	await m.set({id: 0})
	await m.set({id: ''})
	const all = await m.all()
	expect(all).toHaveLength(2)
	expect(all.every(r => !r.id)).toBe(true)
})

test('set without id', async () => {
	const m = getModel()
	const obj = {fluffy: true}
	const saved = await m.set(obj)
	expect(saved.id).toBeTruthy()
	expect(saved.fluffy).toBe(obj.fluffy)
})

test('set without id, INTEGER type', async () => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	const o = await m.set({})
	const all = await m.all()
	expect([o]).toEqual(all)
})

test('INTEGER autoIncrement id', async () => {
	const m = getModel({columns: {id: {type: 'INTEGER', autoIncrement: true}}})
	await m.set({id: 50})
	await m.remove({id: 50})
	await m.set({})
	const all = await m.all()
	expect([{id: 51}]).toEqual(all)
})

test('set with existing id', async () => {
	let val = 5
	const m = getModel({columns: {id: {value: () => val}}})
	await m.set({hi: true})
	const o = await m.searchOne()
	expect(o.id).toBe('5')
	val = 6
	await m.set(o)
	const p = await m.all()
	expect(p).toHaveLength(1)
	expect(p[0].id).toBe('5')
})

test('id/col slugValue', async () => {
	const m = getModel({
		columns: {
			id: {slugValue: o => o.hi.slice(0, 3)},
			hi: {jsonPath: 'hi'},
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
		await expect(m.get(null)).rejects.toThrow()
		await expect(m.get(undefined)).rejects.toThrow()
	})
)

test('get w/ other colName', async () => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, slug: {jsonPath: 'slug'}},
	})
	await m.set({id: 0, slug: 10})
	expect(await m.get(10, 'slug')).toEqual({id: 0, slug: 10})
})

test('getAll', async () => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, slug: {jsonPath: 'slug'}},
	})
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id, slug: id + 10})))
	expect(await m.getAll([4, 'nope', 0])).toEqual([
		{id: 4, slug: 14},
		undefined,
		{id: 0, slug: 10},
	])
	expect(await m.getAll([10, 'nope', 12], 'slug')).toEqual([
		{id: 0, slug: 10},
		undefined,
		{id: 2, slug: 12},
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
	const m = getModel({idCol: 'v', columns: {foo: {jsonPath: 'foo'}}})
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
		`SELECT "v" AS _1,"json" AS _2 FROM "testing" tbl ORDER BY "v" LIMIT 2`,
		[],
		['_1', '_2'],
	])
})

test('set(obj, insertOnly)', async () => {
	const m = getModel()
	await m.set({id: 234})
	await expect(m.set({id: 234}, true)).rejects.toThrow('SQLITE_CONSTRAINT')
})

test('update(obj)', async () => {
	const m = getModel()
	const obj = await m.update({hi: 5, ho: 8}, true)
	const {id} = obj
	expect(await m.get(id)).toEqual(obj)
	await m.update({id, hi: 7})
	expect(await m.get(id)).toEqual({...obj, hi: 7})
})

test('update(obj, upsert)', async () => {
	const m = getModel()
	await m.set({id: 5, ho: 8})
	await expect(m.update({id: 5, ho: 1})).resolves.toEqual({id: 5, ho: 1})
	await expect(m.update({id: 7, ho: 2})).rejects.toThrow('No object')
	await expect(m.update({id: 7, ho: 3}, true)).resolves.toEqual({id: 7, ho: 3})
	await expect(m.update({ho: 4}, true)).resolves.toMatchObject({ho: 4})
	expect(await m.count()).toBe(3)
})

test('update transactional', async () => {
	const m = getModel()
	await m.db.run(`BEGIN IMMEDIATE`)
	await expect(m.update({id: 5, ho: 9}, true)).rejects.toThrow(
		'cannot start a transaction within a transaction'
	)
})

test('updateNoTrans not transactional', async () => {
	const m = getModel()
	await m.db.run(`BEGIN IMMEDIATE`)
	await expect(m.updateNoTrans({id: 5, ho: 9}, true)).resolves.not.toThrow()
	await m.db.run(`END`)
})
