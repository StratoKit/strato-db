import test from 'ava'
import DB from '../DB'
import EventQueue from '../EventQueue'

const getModel = options => {
	const db = new DB()
	return db.addModel(EventQueue, options)
}

const populate = (m, count) => {
	const lots = []
	for (let i = 0; i < count; i++) {
		lots[i] = i
	}
	return Promise.all(lots.map(data => m.add('t', data)))
}
test('add invalid event', async t => {
	const m = getModel()
	await t.throws(m.add())
	await t.throws(m.add(''))
	await t.throws(m.add(123))
})

test('_getLatestVersion', async t => {
	const m = getModel()
	t.is(await m._getLatestVersion(), 1)
	// internal API
	m.knownV = 20
	t.is(await m._getLatestVersion(), 20)
	await m.set({v: 500, type: 'fooo'})
	t.is(await m._getLatestVersion(), 500)
})

test('add event', async t => {
	const m = getModel()
	const e = await m.add('test', {foo: 'hi'})
	t.truthy(e.v)
	t.truthy(e.ts)
	t.is(e.data.foo, 'hi')

	await t.notThrows(populate(m, 200))
	const events = await m.search({type: 't'})
	t.is(events.items.length, 200)
})

test('getNext(undef/0)', async t => {
	const m = getModel({knownV: 50})
	await populate(m, 5)
	const e = await m.getNext()
	t.is(e.v, 51)
})

test('getNext() waits', async t => {
	const m = getModel({knownV: 10})
	t.falsy(await m.get({v: 11}))
	const p = m.getNext()
	await m.add('t')
	const e = await p
	t.is(e && e.v, 11)
	const q = m.getNext(e.v)
	await m.add('u')
	const f = await q
	t.is(f.v, 12)
	t.is(f.type, 'u')
})

test('getNext(v, true) polls once', async t => {
	const m = getModel({knownV: 10})
	t.falsy(await m.get({v: 11}))
	const p = m.getNext(null, true)
	await m.add('t')
	const e = await p
	t.is(e, undefined)
	const f = await m.getNext(10, true)
	t.is(f.v, 11)
	t.is(f.type, 't')
})

test('allow JsonModel migrations', async t => {
	const m = getModel({
		migrations: {
			test: {
				up({model}) {
					return model.add('TEST', {hi: true})
				},
			},
		},
	})
	const e = await m.getNext()
	t.true(e.data.hi)
})
