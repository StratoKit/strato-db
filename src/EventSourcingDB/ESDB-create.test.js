import sysPath from 'path'
import tmp from 'tmp-promise'
import {JsonModel} from '..'
import ESDB from '.'
import {withESDB, testModels, DB} from '../lib/_test-helpers'

const events = [
	{v: 1, type: 'foo'},
	{v: 2, type: 'bar', data: {gotBar: true}},
]

describe('ESDB create', () => {
	test('works', () =>
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
				expect(eSDB.store.count).toBeTruthy()
				expect(eSDB.rwStore.count).toBeTruthy()
				// Make sure the read-only database can start (no timeout)
				// and that migrations work
				expect(await eSDB.store.count.all()).toEqual([
					{id: 'count', total: 0, byType: {}},
				])
			},
			{unsafeCleanup: true, prefix: 'esdb-create'}
		))

	test('with existing version', () =>
		tmp.withDir(
			async ({path: dir}) => {
				const file = sysPath.join(dir, 'db')
				const db = new DB({file})
				await db.userVersion(100)
				const queueFile = sysPath.join(dir, 'q')
				const eSDB = new ESDB({
					file,
					queueFile,
					name: 'E',
					models: testModels,
				})
				// Note that this only works if you open the db first
				await eSDB.waitForQueue()
				const e = await eSDB.dispatch('hi')
				expect(e.v).toBe(101)
			},
			{unsafeCleanup: true}
		))

	test('in single file', async () => {
		const eSDB = new ESDB({
			name: 'E',
			models: testModels,
		})
		// eSDB.listen(changes => eSDB.reducers.count.get('count'))
		expect(eSDB.db).toBeTruthy()
		expect(eSDB.rwDb).toBeTruthy()
		expect(eSDB.queue).toBeTruthy()
		expect(eSDB.models).toBeUndefined()
		expect(eSDB.store.count).toBeTruthy()
		expect(eSDB.rwStore.count).toBeTruthy()
		// Make sure the read-only database can start (no timeout)
		// and that migrations work
		expect(await eSDB.store.count.all()).toEqual([
			{id: 'count', total: 0, byType: {}},
		])
	})

	test('with Model', () => {
		return withESDB(
			{
				count: {
					Model: class Count extends JsonModel {
						constructor(options) {
							if (typeof options.dispatch !== 'function') {
								throw new TypeError('Dispatch expected')
							}
							if (typeof options.emitter !== 'object') {
								throw new TypeError('emitter expected')
							}
							delete options.emitter
							super(options)
						}

						foo() {
							return true
						}
					},
					reducer: testModels.count.reducer,
				},
			},
			eSDB => {
				expect(eSDB.store.count.foo()).toBe(true)
			}
		)
	})

	test('without given queue', async () => {
		let eSDB
		expect(() => {
			eSDB = new ESDB({models: {}})
		}).not.toThrow()
		await expect(eSDB.dispatch('hi')).resolves.toHaveProperty('v', 1)
	})
})

describe('redux cycle', () => {
	test('reducer works', () => {
		return withESDB(async eSDB => {
			const result = await eSDB._reducer({}, events[0])
			expect(result).toEqual({
				v: 1,
				type: 'foo',
				result: {
					count: {set: [{id: 'count', total: 1, byType: {foo: 1}}]},
				},
			})
			const result2 = await eSDB._reducer({}, events[1])
			expect(result2).toEqual({
				v: 2,
				type: 'bar',
				data: {gotBar: true},
				result: {
					count: {set: [{id: 'count', total: 1, byType: {bar: 1}}]},
				},
			})
		})
	})

	test('preprocess changes pass to reduce', () => {
		const models = {
			foo: {
				preprocessor: ({event}) => {
					if (event.type !== 'meep') return
					return {...event, step: 1}
				},
				reducer: ({event}) => {
					if (event.type !== 'meep') return
					expect(event).toHaveProperty('step', 1)
				},
			},
		}
		return withESDB(models, async eSDB => {
			await eSDB.dispatch('meep')
		})
	})
})

describe('ESDB migrations', () => {
	test('model migrations get queue', async () => {
		let step = 0
		return withESDB(
			{
				count: {
					...testModels.count,
					migrations: {
						async foo({db, model, queue}) {
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
			async eSDB => {
				await eSDB.open()
				expect(step).toBe(1)
				const e = await eSDB.queue.searchOne()
				expect(e.type).toBe('foo')
			}
		)
	})

	test('metadata migration', async () => {
		class M extends JsonModel {
			constructor({emitter: _1, ...props}) {
				super({
					...props,
					migrations: {
						...props.migrations,
						1: async ({model}) => model.set({id: 'version', v: 5}),
					},
				})
			}

			// eslint-disable-next-line no-unused-vars
			static reducer(args) {}
		}
		const eSDB = new ESDB({
			models: {metadata: {Model: M}},
		})
		// Version should be moved to user_version
		expect(await eSDB.db.get('PRAGMA user_version')).toHaveProperty(
			'user_version',
			5
		)
		// metadata table should be gone
		expect(
			await eSDB.db.get('SELECT * FROM sqlite_master WHERE name="metadata"')
		).toBeFalsy()
	})

	test('metadata migration with existing data', async () => {
		class M extends JsonModel {
			constructor({emitter: _1, ...props}) {
				super({
					...props,
					migrations: {
						...props.migrations,
						1: async ({model}) => {
							await model.set({id: 'version', v: 5})
							await model.set({id: 'hi'})
						},
					},
				})
			}

			// eslint-disable-next-line no-unused-vars
			static reducer(args) {}
		}
		const eSDB = new ESDB({
			models: {metadata: {Model: M}},
		})
		// Version should be moved to user_version
		expect(await eSDB.db.get('PRAGMA user_version')).toHaveProperty(
			'user_version',
			5
		)
		// metadata table should still be there
		expect(
			await eSDB.db.get('SELECT * FROM sqlite_master WHERE name="metadata"')
		).toBeTruthy()
		// but version should be gone
		expect(
			await eSDB.db.get('SELECT * FROM metadata WHERE id="version"')
		).toBeFalsy()
	})
})
