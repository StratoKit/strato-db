import DB from './DB'
import EventQueue from './EventQueue'

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

test('create w/ extra columns', async () => {
	const m = getModel({columns: {foo: {real: true, value: () => 5, get: true}}})
	expect(await m.add('hi')).not.toHaveProperty('foo')
	expect(await m.get(1)).not.toHaveProperty('foo', 5)
	await m.update({v: 1})
	expect(await m.get(1)).toHaveProperty('foo', 5)
})

test('add invalid event', async () => {
	const m = getModel()
	await expect(m.add()).rejects.toThrow('type should be a non-empty string')
	await expect(m.add('')).rejects.toThrow('type should be a non-empty string')
	await expect(m.add(123)).rejects.toThrow('type should be a non-empty string')
})

test('setKnownV', async () => {
	const m = getModel()
	expect(await m._getLatestVersion()).toBe(0)
	// internal API
	await m.setKnownV(20)
	expect(await m._getLatestVersion()).toBe(20)
	await m.set({v: 500, type: 'fooo'})
	expect(await m._getLatestVersion()).toBe(500)
})

test('add event', async () => {
	const m = getModel()
	const e = await m.add('test', {foo: 'hi'})
	expect(e.v).toBeTruthy()
	expect(e.ts).toBeTruthy()
	expect(e.data.foo).toBe('hi')

	await expect(populate(m, 200)).resolves.not.toThrow()
	const events = await m.search({type: 't'})
	expect(events.items).toHaveLength(200)
})

test('getNext(undef/0)', async () => {
	const m = getModel()
	await m.setKnownV(50)
	await populate(m, 5)
	const e = await m.getNext()
	expect(e.v).toBe(51)
})

test('getNext() waits', async () => {
	const m = getModel()
	await m.setKnownV(10)
	expect(await m.get({v: 11})).toBeFalsy()
	const p = m.getNext()
	await m.add('t')
	const e = await p
	expect(e && e.v).toBe(11)
	const q = m.getNext(e.v)
	await m.add('u')
	const f = await q
	expect(f.v).toBe(12)
	expect(f.type).toBe('u')
})

test('getNext(v, true) polls once', async () => {
	const m = getModel()
	await m.setKnownV(10)
	expect(await m.get(11)).toBeFalsy()
	expect(await m.getNext(null, true)).toBe(undefined)
	await m.add('t')
	const f = await m.getNext(10, true)
	expect(f.v).toBe(11)
	expect(f.type).toBe('t')
})

test('allow JsonModel migrations', async () => {
	const m = getModel({
		migrations: {
			test({model}) {
				return model.add('TEST', {hi: true})
			},
		},
	})
	const e = await m.getNext()
	expect(e.data.hi).toBe(true)
})

test('type query uses index', async () => {
	const m = getModel()
	expect(
		await m.db.get(
			`EXPLAIN QUERY PLAN SELECT type FROM history where type='foo'`
		)
	).toHaveProperty('detail', expect.stringContaining('USING COVERING INDEX'))
})
