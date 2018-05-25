import expect from 'expect'
import sysPath from 'path'
import tmp from 'tmp-promise'
import JsonModel from '../JsonModel'
import ESDB from '../EventSourcingDB'
import {withESDB, testModels} from './_helpers'

const events = [{v: 1, type: 'foo'}, {v: 2, type: 'bar', data: {gotBar: true}}]

test('create', () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const queueFile = sysPath.join(dir, 'q')
			const eSDB = new ESDB({
				file,
				queueFile,
				name: 'E',
				models: testModels,
			})
			// eSDB.listen(changes => eSDB.reducers.count.get('count'))
			expect(eSDB.db).toBeTruthy()
			expect(eSDB.rwDb).toBeTruthy()
			expect(eSDB.queue).toBeTruthy()
			expect(eSDB.models).toBeUndefined()
			expect(eSDB.store && eSDB.store.metadata).toBeTruthy()
			expect(eSDB.store.count).toBeTruthy()
			expect(eSDB.rwStore && eSDB.rwStore.metadata).toBeTruthy()
			expect(eSDB.rwStore.count).toBeTruthy()
			expect(() => withESDB(() => {}, {metadata: {}})).toThrow()
			// Make sure the read-only database can start (no timeout)
			// and that migrations work
			expect(await eSDB.store.count.all()).toEqual([
				{id: 'count', total: 0, byType: {}},
			])
		},
		{unsafeCleanup: true}
	))

test('create with Model', () => {
	return withESDB(
		eSDB => {
			expect(eSDB.store.count.foo()).toBe(true)
		},
		{
			count: {
				Model: class Count extends JsonModel {
					constructor(options) {
						if (typeof options.dispatch !== 'function') {
							throw new TypeError('Dispatch expected')
						}
						super(options)
					}

					foo() {
						return true
					}
				},
				reducer: testModels.count.reducer,
			},
		}
	)
})

test('create without given queue', async () => {
	let eSDB
	expect(() => {
		eSDB = new ESDB({models: {}})
	}).not.toThrow()
	await expect(eSDB.dispatch('hi')).resolves.toHaveProperty('v', 1)
})

test('reducer', () => {
	return withESDB(async eSDB => {
		const result = await eSDB.reducer(null, events[0])
		expect(result).toEqual({
			v: 1,
			type: 'foo',
			result: {
				count: {set: [{id: 'count', total: 1, byType: {foo: 1}}]},
				metadata: {set: [{id: 'version', v: 1}]},
			},
		})
		const result2 = await eSDB.reducer(null, events[1])
		expect(result2).toEqual({
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

test('applyEvent', () => {
	return withESDB(async eSDB => {
		await eSDB.db.withTransaction(() =>
			eSDB.applyEvent({
				v: 1,
				type: 'foo',
				result: {
					count: {set: [{id: 'count', total: 1, byType: {foo: 1}}]},
					metadata: {set: [{id: 'version', v: 1}]},
				},
			})
		)
		expect(await eSDB.store.count.get('count')).toEqual({
			id: 'count',
			total: 1,
			byType: {foo: 1},
		})
		expect(await eSDB.store.metadata.get('version')).toEqual({
			id: 'version',
			v: 1,
		})
	})
})

test('applyEvent invalid', () => {
	return withESDB(async eSDB => {
		await expect(
			eSDB.applyEvent({
				v: 1,
				type: 'foo',
				result: {
					// it will try to call map as a function
					metadata: {set: {map: 5}},
				},
			})
		).rejects.toThrow('not a function')
	})
})

test('waitForQueue', async () =>
	withESDB(async (eSDB, queue) => {
		await expect(eSDB.waitForQueue()).resolves.toBeFalsy()
		await queue.add('ONE')
		await queue.add('TWO')
		expect(await eSDB.getVersion()).toBe(0)
		const p = eSDB.waitForQueue()
		await queue.add('THREE')
		queue.add('FOUR')
		expect((await p).type).toBe('TWO')
		await expect(eSDB.waitForQueue()).resolves.toHaveProperty('type', 'FOUR')
		// This should return immediately, if not the test will time out
		await expect(eSDB.waitForQueue()).resolves.toHaveProperty('type', 'FOUR')
	}))

test('waitForQueue race', async () =>
	withESDB(async (eSDB, queue) => {
		queue.add('1')
		queue.add('2')
		eSDB.waitForQueue()
		queue.add('3')
		await eSDB.handledVersion(3)
		await eSDB.handledVersion(3)
		queue.add('4')
		queue.add('5')
		queue.add('6')
		eSDB.waitForQueue()
		await eSDB.handledVersion(3)
		await eSDB.handledVersion(3)
		queue.add('7')
		eSDB.waitForQueue()
		await eSDB.waitForQueue()
		queue.add('8')
		queue.add('9')
		await eSDB.handledVersion(9)
		await eSDB.handledVersion(9)
		queue.add('10')
		queue.add('11')
		queue.add('12')
		const p = eSDB.handledVersion(12)
		eSDB.startPolling(12)
		await p
	}))

test('incoming event', async () => {
	return withESDB(async eSDB => {
		const event = await eSDB.queue.add('foobar')
		await eSDB.handledVersion(event.v)
		expect(await eSDB.store.count.get('count')).toEqual({
			id: 'count',
			total: 1,
			byType: {foobar: 1},
		})
	})
})

// Not to be encouraged but it's possible. You can lose events during rollbacks
test('queue in same db', async () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const eSDB = new ESDB({
				file,
				queueFile: file,
				name: 'E',
				models: testModels,
			})
			const {queue} = eSDB
			queue.add('boop')
			const {v} = await queue.add('moop')
			eSDB.checkForEvents()
			await eSDB.handledVersion(v)
			const history = await eSDB.queue.all()
			expect(history).toHaveLength(2)
			expect(history[0].type).toBe('boop')
			expect(history[0].result).toBeTruthy()
			expect(history[1].type).toBe('moop')
			expect(history[1].result).toBeTruthy()
		},
		{unsafeCleanup: true}
	))

test('dispatch', async () => {
	return withESDB(async eSDB => {
		const event1P = eSDB.dispatch('whattup', 'indeed', 42)
		const event2P = eSDB.dispatch('dude', {woah: true}, 55)
		expect(await event2P).toEqual({
			v: 2,
			type: 'dude',
			ts: 55,
			data: {woah: true},
			result: {
				count: {set: [{id: 'count', total: 2, byType: {whattup: 1, dude: 1}}]},
			},
		})
		expect(await event1P).toEqual({
			v: 1,
			type: 'whattup',
			ts: 42,
			data: 'indeed',
			result: {
				count: {set: [{id: 'count', total: 1, byType: {whattup: 1}}]},
			},
		})
	})
})

test('reducer migration', async () => {
	let step = 0
	return withESDB(
		async eSDB => {
			// Wait for migrations to run
			await eSDB.store.count.searchOne()
			expect(step).toBe(1)
			const e = await eSDB.queue.searchOne()
			expect(e.type).toBe('foo')
		},
		{
			count: {
				...testModels.count,
				migrations: {
					foo: {
						async up({db, model, queue}) {
							expect(step).toBe(0)
							step = 1
							expect(db).toBeTruthy()
							expect(model).toBeTruthy()
							expect(queue).toBeTruthy()
							await queue.add('foo', 0)
						},
					},
				},
			},
		}
	)
})

test('derivers', async () => {
	return withESDB(async eSDB => {
		await eSDB.dispatch('bar')
		expect(await eSDB.store.deriver.searchOne()).toEqual({
			desc: 'Total: 1, seen types: bar',
			id: 'descCount',
		})
	})
})

test('preprocessors', async () => {
	return withESDB(
		async eSDB => {
			await expect(eSDB.dispatch('pre type')).rejects.toHaveProperty(
				'error._preprocess.message'
			)
			await expect(eSDB.dispatch('pre version')).rejects.toHaveProperty(
				'error._preprocess.message'
			)
			await expect(eSDB.dispatch('bad event')).rejects.toHaveProperty(
				'error.meep',
				'Yeah, no.'
			)
			await eSDB.dispatch('create_thing', {foo: 2})
			expect(await eSDB.store.meep.searchOne()).toEqual({
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

test.skip('event error in reducer', () =>
	withESDB(async eSDB => {
		await eSDB.dispatch
		// All the below: don't call next phases
		// Error in preprocessor => error: _preprocess
		// Error in reducer => error: _redux
		// Error in apply => error: _apply
		// Error in derive => error: _derive
	}))

test('event emitter', async () => {
	return withESDB(async eSDB => {
		let handled = 0,
			errored = 0,
			resulted = 0
		eSDB.on('result', event => {
			resulted++
			expect(event.error).toBeFalsy()
			expect(event.result).toBeTruthy()
		})
		eSDB.on('error', event => {
			errored++
			expect(event.error).toBeTruthy()
			expect(event.result).toBeUndefined()
		})
		eSDB.on('handled', event => {
			handled++
			expect(event).toBeTruthy()
			// Get called in order
			expect(event.v).toBe(handled)
		})
		eSDB.dispatch('foo')
		eSDB.dispatch('bar')
		await expect(eSDB.dispatch('errorme')).rejects.toHaveProperty(
			'error._redux.message',
			'error for you'
		)
		expect(handled).toBe(3)
		expect(errored).toBe(1)
		expect(resulted).toBe(2)
	})
})

test('event replay', async () =>
	withESDB(async (eSDB, queue) => {
		queue.set({
			v: 1,
			type: 'TEST',
			data: {hi: true},
			result: {},
			error: {test: true},
		})

		await expect(eSDB.handledVersion(1)).resolves.not.toHaveProperty('error')
	}))
