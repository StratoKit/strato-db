import test from 'ava'
import {DB, JsonModel, getModel, sharedSetup} from './_helpers'

test('create', t => {
	const m = getModel()
	t.notThrows(() => m.all())
	t.is(m.db.models[m.name], m)
})

test('create invalid', t => {
	const db = new DB()
	t.throws(() => new JsonModel())
	t.throws(() => new JsonModel({db}))
	t.throws(() => new JsonModel({name: 'foo'}))
})

test('derived set', async t => {
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
	t.true(ran)
})

test('id generation', async t => {
	const m = getModel({columns: {id: {value: o => o.foo}}})
	const idFn = m.columns.id.value.bind(m)
	t.truthy(await idFn({}))
	t.is(await idFn({id: 'hi'}), 'hi')
	t.is(await idFn({foo: 'ho'}), 'ho')
	t.is(await idFn({foo: 0}), 0)
	t.is(await idFn({foo: ''}), '')
	t.truthy(await idFn({foo: null}))
})

test('async id generation', async t => {
	const m = getModel({columns: {id: {value: async o => o.foo}}})
	const idFn = m.columns.id.value.bind(m)
	t.truthy(await idFn({}))
	t.is(await idFn({id: 'hi'}), 'hi')
	t.is(await idFn({foo: 'ho'}), 'ho')
	t.is(await idFn({foo: 0}), 0)
	t.is(await idFn({foo: ''}), '')
	t.truthy(await idFn({foo: null}))
})

test('set with id', async t => {
	const m = getModel()
	const obj = {id: 'foobar', fluffy: true}
	const set = await m.set(obj)
	const saved = await m.get(set.id)
	t.deepEqual(saved, obj)
	t.deepEqual(saved, set)
})

test('set with falsy id, BLOB type', async t => {
	const m = getModel({columns: {id: {type: 'BLOB'}}})
	await m.set({id: 0})
	await m.set({id: ''})
	const all = await m.all()
	t.is(all.length, 2)
	t.true(all.every(r => !r.id))
})

test('set without id', async t => {
	const m = getModel()
	const obj = {fluffy: true}
	const saved = await m.set(obj)
	t.truthy(saved.id)
	t.is(saved.fluffy, obj.fluffy)
})

test('set without id, INTEGER type', async t => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	const o = await m.set({})
	const all = await m.all()
	t.deepEqual([o], all)
})

test('INTEGER autoIncrement id', async t => {
	const m = getModel({columns: {id: {type: 'INTEGER', autoIncrement: true}}})
	await m.set({id: 50})
	await m.delete({id: 50})
	await m.set({})
	const all = await m.all()
	t.deepEqual([{id: 51}], all)
})

test('set with existing id', async t => {
	let val = 5
	const m = getModel({columns: {id: {value: () => val}}})
	await m.set({hi: true})
	const o = await m.searchOne()
	t.is(o.id, '5')
	val = 6
	await m.set(o)
	const p = await m.all()
	t.is(p.length, 1)
	t.is(p[0].id, '5')
})

test('id/col slugValue', async t => {
	const m = getModel({
		columns: {
			id: {slugValue: o => o.hi.slice(0, 3)},
			hi: {jsonPath: 'hi'},
			other: {slugValue: o => o.hi.toUpperCase(), index: true, get: true},
		},
	})
	await m.set({hi: 'hello'})
	const o = await m.searchOne()
	t.deepEqual(o, {id: 'hel', hi: 'hello', other: 'hello'})
	await m.set({hi: 'Hello'})
	const p = await m.searchOne({hi: 'Hello'})
	t.deepEqual(p, {id: 'hel-2', hi: 'Hello', other: 'hello-2'})
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
	withObjs(async (m, t) => {
		t.deepEqual(await m.get(0), {id: '0', moop: 8})
		t.deepEqual(await m.get(''), {id: '', moop: 9})
	})
)

test(
	'get by id',
	withObjs(async (m, t) => {
		t.deepEqual(await m.get('foobar'), {id: 'foobar', fluffy: true})
	})
)

test(
	'get w/ auto id',
	withObjs(async (m, t) => {
		const obj = {fluffier: true}
		const withId = await m.set(obj)
		const saved = await m.get(withId.id)
		t.deepEqual(saved, withId)
		t.true(saved.fluffier)
	})
)

test(
	'get w/ null id',
	withObjs(async (m, t) => {
		t.throws(m.get(null))
		return t.throws(m.get(undefined))
	})
)

test('getAll', async t => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, slug: {jsonPath: 'slug'}},
	})
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id, slug: id + 10})))
	t.deepEqual(await m.getAll([4, 'nope', 0]), [
		{id: 4, slug: 14},
		undefined,
		{id: 0, slug: 10},
	])
	t.deepEqual(await m.getAll([10, 'nope', 12], 'slug'), [
		{id: 0, slug: 10},
		undefined,
		{id: 2, slug: 12},
	])
})

test('all', async t => {
	const m = getModel()
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const saved = await m.all()
	t.is(saved.length, 5)
	t.true(saved.some(r => r.id === '4'))
	t.true(saved.some(r => r.id === '1'))
})

test('delete undefined', async t => {
	const m = getModel()
	const p = m.delete()
	await t.notThrows(p)
})

test('delete', async t => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	await m.set({id: 123})
	await t.notThrows(() => m.delete(123))
	t.falsy(await m.get(123))
	await m.set({id: 234})
	await t.notThrows(() => m.delete({id: 234}))
	t.falsy(await m.get(234))
})

test('count', async t => {
	const m = getModel()
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const count = await m.count(null, {where: {'id > 2': []}})
	t.is(count, 2)
})

test('idCol', async t => {
	const m = getModel({idCol: 'v', columns: {foo: {jsonPath: 'foo'}}})
	await Promise.all([0, 1, 2, 3, 4].map(v => m.set({v})))
	t.deepEqual(await m.get(1), {v: '1'})
	t.deepEqual(await m.get(1), {v: '1'})
	const n = await m.set({foo: 342})
	t.truthy(n.v)
	m.set({v: n.v, foo: 342})
	const n2 = await m.search({foo: 342})
	t.is(n2.items.length, 1)
	t.truthy(await m.get(n.v))
	await m.delete(n.v)
	t.falsy(await m.get(n.v))
	t.deepEqual(m.makeSelect({limit: 2}), [
		`SELECT "v" AS _1,"json" AS _2 FROM "testing" tbl ORDER BY "v" LIMIT 2`,
		[],
		['_1', '_2'],
	])
})

test('set(obj, insertOnly)', async t => {
	const m = getModel()
	await m.set({id: 234})
	await t.throws(m.set({id: 234}, true))
})
