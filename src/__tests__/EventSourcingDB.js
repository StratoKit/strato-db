import test from 'ava'
import DB from '../DB'
import JsonModel from '../JsonModel'
import EQ from '../EventQueue'
import ESDB from '../EventSourcingDB'

const testModels = {
	count: {
		// shortName: 'c',
		columns: {
			total: {type: 'INTEGER', value: o => o.total, get: true},
		},
		// Needs JsonModel to create intermediate jM to set values
		// migrations: {
		// 	0: {up(db, jM) => jM.set({id: 'count', total: 0, byType: {}})},
		// },
		reducer: async (model, {type}) => {
			if (!model) {
				return {}
			}
			const c = (await model.get('count')) || {
				id: 'count',
				total: 0,
				byType: {},
			}
			c.total++
			c.byType[type] = (c.byType[type] || 0) + 1
			return {
				set: [c],
				// audit: '',
			}
		},
	},
	ignorer: {
		reducer: (model = null) => model,
	},
	deriver: {
		deriver: async ({model, store, result}) => {
			if (result.count) {
				const currentCount = await store.count.get('count')
				await model.set({
					id: 'descCount',
					desc: `Total: ${currentCount.total}, seen types: ${Object.keys(
						currentCount.byType
					)}`,
				})
			}
		},
	},
}

const events = [{v: 1, type: 'foo'}, {v: 2, type: 'bar', data: {gotBar: true}}]

const withDBs = fn => {
	const db = new DB()
	const queue = new EQ({db: new DB()})
	return fn(db, queue)
}
const withESDB = (fn, models = testModels) =>
	withDBs((db, queue) => {
		const eSDB = new ESDB({db, queue, models})
		return fn(eSDB)
	})

test('create', t => {
	return withESDB(eSDB => {
		// eSDB.listen(changes => eSDB.reducers.count.get('count'))
		// await queue.add('whee')
		t.truthy(eSDB.db)
		t.truthy(eSDB.queue)
		t.truthy(eSDB.store && eSDB.store.metadata)
		t.truthy(eSDB.store.count)
		t.truthy(eSDB.history)
		t.throws(() => withESDB(() => {}, {history: {}}))
		t.throws(() => withESDB(() => {}, {metadata: {}}))
	})
})

test('create with Model', t => {
	return withESDB(
		eSDB => {
			t.true(eSDB.store.count.foo())
		},
		{
			count: {
				Model: class Count extends JsonModel {
					foo() {
						return true
					}
				},
				reducer: testModels.count.reducer,
			},
		}
	)
})

test('create without given queue', async t => {
	const db = new DB()
	let eSDB
	t.notThrows(() => {
		eSDB = new ESDB({db, models: {}})
	})
	await t.notThrows(eSDB.dispatch('hi'))
})

test('reducer', t => {
	return withESDB(async eSDB => {
		const result = await eSDB.reducer(null, events[0])
		t.deepEqual(result, {
			v: 1,
			type: 'foo',
			result: {
				count: {set: [{id: 'count', total: 1, byType: {foo: 1}}]},
				metadata: {set: [{id: 'version', v: 1}]},
			},
		})
		const result2 = await eSDB.reducer(null, events[1])
		t.deepEqual(result2, {
			v: 2,
			type: 'bar',
			data: {gotBar: true},
			result: {
				count: {set: [{id: 'count', total: 1, byType: {bar: 1}}]},
				metadata: {set: [{id: 'version', v: 2}]},
			},
		})
	})
})

test('applyEvent', t => {
	return withESDB(async eSDB => {
		await eSDB.applyEvent({
			v: 1,
			type: 'foo',
			result: {
				count: {set: [{id: 'count', total: 1, byType: {foo: 1}}]},
				metadata: {set: [{id: 'version', v: 1}]},
			},
		})
		t.deepEqual(await eSDB.store.count.get('count'), {
			id: 'count',
			total: 1,
			byType: {foo: 1},
		})
		t.deepEqual(await eSDB.store.metadata.get('version'), {id: 'version', v: 1})
	})
})

test('applyEvent invalid', t => {
	return withESDB(async eSDB => {
		await t.throws(
			eSDB.applyEvent(
				{
					v: 1,
					type: 'foo',
					result: {
						// it will try to call map as a function
						metadata: {set: {map: 5}},
					},
				},
				true
			)
		)
	})
})

test('incoming event', async t => {
	return withESDB(async eSDB => {
		const event = await eSDB.queue.add('foobar')
		await eSDB.handledVersion(event.v)
		t.deepEqual(await eSDB.store.count.get('count'), {
			id: 'count',
			total: 1,
			byType: {foobar: 1},
		})
	})
})

test('queue in same db', async t => {
	const db = new DB()
	const queue = new EQ({db})
	const eSDB = new ESDB({db, queue, models: testModels})
	t.is(eSDB.history, queue)
	queue.add('boop')
	const {v} = await queue.add('moop')
	eSDB.checkForEvents()
	await eSDB.handledVersion(v)
	const history = await eSDB.history.all()
	t.is(history.length, 2)
	t.is(history[0].type, 'boop')
	t.truthy(history[0].result)
	t.is(history[1].type, 'moop')
	t.truthy(history[1].result)
})

test('dispatch', async t => {
	return withESDB(async eSDB => {
		const event1P = eSDB.dispatch('whattup', 'indeed', 42)
		const event2P = eSDB.dispatch('dude', {woah: true}, 55)
		t.deepEqual(await event1P, {
			v: 1,
			type: 'whattup',
			ts: 42,
			data: 'indeed',
			result: {
				count: {set: [{id: 'count', total: 1, byType: {whattup: 1}}]},
				metadata: {set: [{id: 'version', v: 1}]},
			},
		})
		t.deepEqual(await event2P, {
			v: 2,
			type: 'dude',
			ts: 55,
			data: {woah: true},
			result: {
				count: {set: [{id: 'count', total: 2, byType: {whattup: 1, dude: 1}}]},
				metadata: {set: [{id: 'version', v: 2}]},
			},
		})
	})
})

test('reducer migration', async t => {
	let step = 0
	return withESDB(
		async eSDB => {
			// Wait for migrations to run
			await eSDB.store.count.searchOne()
			t.is(step, 1)
			const e = await eSDB.queue.searchOne()
			t.is(e.type, 'foo')
		},
		{
			count: {
				...testModels.count,
				migrations: {
					foo: {
						async up({db, model, queue}) {
							t.is(step, 0)
							step = 1
							t.truthy(db)
							t.truthy(model)
							t.truthy(queue)
							await queue.add('foo', 0)
						},
					},
				},
			},
		}
	)
})

test('derivers', async t => {
	return withESDB(async eSDB => {
		await eSDB.dispatch('bar')
		t.deepEqual(await eSDB.store.deriver.searchOne(), {
			desc: 'Total: 1, seen types: bar',
			id: 'descCount',
		})
	})
})

test('preprocessors', async t => {
	return withESDB(
		async eSDB => {
			await t.throws(eSDB.dispatch('pre type'))
			await t.throws(eSDB.dispatch('pre version'))
			const badEvent = await eSDB.dispatch('bad event').catch(err => err)
			t.is(badEvent.error.meep, 'Yeah, no.')
			await eSDB.dispatch('create_thing', {foo: 2})
			t.deepEqual(await eSDB.store.meep.searchOne(), {
				id: '5',
				foo: 2,
			})
		},
		{
			meep: {
				preprocessor: async ({event, model, store}) => {
					if (!model) throw new Error('expecting my model')
					if (!store) throw new Error('expecting the store')
					if (event.type === 'create_thing') {
						event.type = 'set_thing'
						event.data.id = 5
						return event
					}
					if (event.type === 'pre type') {
						delete event.type
						return event
					}
					if (event.type === 'pre version') {
						event.v = 123
						return event
					}
					if (event.type === 'bad event') {
						return {error: 'Yeah, no.'}
					}
				},
				reducer: (model, event) => {
					if (event.type === 'set_thing') {
						return {set: [event.data]}
					}
					return false
				},
			},
		}
	)
})

test.todo('event emitter')
test.todo('erroring events')
