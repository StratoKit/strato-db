import DB from './DB'
import EventQueue from './EventQueue'

const getModel = async options => {
	const db = new DB()
	const model = db.addModel(EventQueue, {...options})
	await db.open()
	// Wait for migrations to complete
	while (!db.migrationsRan) {
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	return /** @type {InstanceType<typeof EventQueue>} */ (model)
}

const populate = (m, count) => {
	const lots = []
	for (let i = 0; i < count; i++) {
		lots[i] = i
	}
	return Promise.all(lots.map(data => m.add('t', data)))
}

test('create w/ extra columns', async () => {
	const m = await getModel({
		columns: {foo: {real: true, value: () => 5, get: true}},
	})
	expect(await m.add('hi')).not.toHaveProperty('foo')
	expect(await m.get(1)).not.toHaveProperty('foo', 5)
	await m.update({v: 1})
	expect(await m.get(1)).toHaveProperty('foo', 5)
})

test('add invalid event', async () => {
	const m = await getModel()
	await expect(m.add()).rejects.toThrow('type should be a non-empty string')
	await expect(m.add('')).rejects.toThrow('type should be a non-empty string')
	await expect(m.add(123)).rejects.toThrow('type should be a non-empty string')
})

test('setKnownV', async () => {
	const m = await getModel()
	expect(await m.getMaxV()).toBe(0)
	// internal API
	await m.setKnownV(20)
	expect(await m.getMaxV()).toBe(20)
	await m.set({v: 500, type: 'fooo'})
	expect(await m.getMaxV()).toBe(500)
})

test('add event', async () => {
	const m = await getModel()
	const e = await m.add('test', {foo: 'hi'})
	expect(e.v).toBeTruthy()
	expect(e.ts).toBeTruthy()
	expect(e.data.foo).toBe('hi')

	await expect(populate(m, 200)).resolves.not.toThrow()
	const events = await m.search({type: 't'})
	expect(events.items).toHaveLength(200)
})

test('getNext(undef/0)', async () => {
	const m = await getModel()
	await m.setKnownV(50)
	await populate(m, 5)
	const e = await m.getNext()
	expect(e.v).toBe(51)
})

test('getNext() waits', async () => {
	const m = await getModel()
	await m.setKnownV(10)
	expect(await m.get(11)).toBeFalsy()
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

test('getNext() does not skip errored events', async () => {
	const m = await getModel()
	await m.setKnownV(10)

	// Add an event that will error
	await m.set({
		v: 11,
		type: 'error',
		data: {shouldError: true},
		error: {test: 'error'},
	})

	// Add a subsequent event
	await m.add('success', {data: 'ok'})

	// Get the next event - should be the errored one
	const e = await m.getNext(10)
	expect(e.v).toBe(11)
	expect(e.error).toBeTruthy()

	// Get the next event - should be the success one
	const f = await m.getNext(11)
	expect(f.v).toBe(12)
	expect(f.type).toBe('success')
	expect(f.error).toBeFalsy()
})

test('getNext(v, true) polls once', async () => {
	const m = await getModel()
	await m.setKnownV(10)
	expect(await m.get(11)).toBeFalsy()
	expect(await m.getNext(null, true)).toBe(undefined)
	await m.add('t')
	const f = await m.getNext(10, true)
	expect(f.v).toBe(11)
	expect(f.type).toBe('t')
})

test('allow JsonModel migrations', async () => {
	const m = await getModel({
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
	const m = await getModel()
	expect(
		await m.db.get(
			`EXPLAIN QUERY PLAN SELECT type FROM history where type='foo'`
		)
	).toHaveProperty('detail', expect.stringContaining('USING COVERING INDEX'))
})

test(
	'cancelNext',
	// there's a 10s timeout on the NAP, be sure we don't hit that
	{timeout: 1000},
	async () => {
		const m = await getModel()
		const P = m.getNext(100, false)
		m.cancelNext()
		await expect(P).resolves.toBe(null)
	}
)
