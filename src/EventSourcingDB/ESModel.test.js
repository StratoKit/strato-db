import ESModel, {undefToNull, getId} from './ESModel'
import {withESDB} from '../lib/_test-helpers'

class ESModelCustomId extends ESModel {
	constructor(options) {
		super({
			...options,
			columns: {
				myId: {
					index: true,
				},
			},
			idCol: 'myId',
		})
	}
}

class ESModelIntId extends ESModel {
	constructor(options) {
		super({
			...options,
			columns: {
				myId: {
					index: true,
					type: 'INTEGER',
				},
				calc: {value: o => o.myId || 0},
			},
			idCol: 'myId',
		})
	}
}

const sampleObject = {id: 'asd', meep: 'moop', top: 'kek'}

describe('undefToNull', () => {
	test('works', () => {
		const obj = {
			a: 'b',
			c: 4,
			d: new Date('2007-01-01'),
			nested: {
				stuff: 'test',
				asd: undefined,
				dsa: null,
			},
			array: [
				'two plus two is',
				undefined,
				{minus: 1, thats: '?'},
				null,
				'quick maths',
			],
			zxc: null,
			cxz: undefined,
		}
		expect(undefToNull(obj)).toEqual({
			...obj,
			nested: {...obj.nested, asd: null},
			array: [
				'two plus two is',
				null,
				{minus: 1, thats: '?'},
				null,
				'quick maths',
			],
			cxz: null,
		})
	})
})

describe('getId', () => {
	test('standard settings', () =>
		withESDB({test: {Model: ESModel}}, async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBeTruthy()
		}))

	test('custom idCol', () =>
		withESDB({test: {Model: ESModelCustomId}}, async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBeTruthy()
		}))

	test('integer idCol', () =>
		withESDB({test: {Model: ESModelIntId}}, async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBe(1)
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBe(2)
			await eSDB.store.test.set({myId: 7, asd: 'dsa'})
			expect(await getId(eSDB.store.test, {moop: 'meep'})).toBe(8)
		}))
})

describe('ESModel', () => {
	test('create', () =>
		withESDB({test: {Model: ESModel}}, async eSDB => {
			const result = await eSDB.store.test.all()
			expect(result).toEqual([])
		}))

	test('init', () =>
		withESDB(
			{
				m: {
					init: true,
					reducer: ({model, event}) =>
						event.type === model.INIT ? {ins: [{id: 'yey'}]} : false,
				},
			},
			async eSDB => {
				await eSDB.waitForQueue()
				const {m} = eSDB.store
				expect(await m.exists({id: 'yey'})).toBeTruthy()
			}
		))

	describe('.set()', () => {
		test('with id', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				expect(await eSDB.store.test.set(sampleObject)).toEqual(sampleObject)
			}))

		test('without id', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				const newObject = await eSDB.store.test.set({
					...sampleObject,
					id: undefined,
				})
				expect(await eSDB.store.test.get(newObject.id)).toEqual(newObject)
			}))

		test('without integer id', () =>
			withESDB({test: {Model: ESModelIntId}}, async eSDB => {
				const sampleWithoutId = {
					...sampleObject,
					id: undefined,
				}
				await Promise.all([
					eSDB.store.test.set(sampleWithoutId),
					eSDB.store.test.set(sampleWithoutId),
					eSDB.store.test.set(sampleWithoutId),
				])
				expect(await getId(eSDB.store.test, {top: 'kek'})).toEqual(4)
				expect(await eSDB.store.test.count()).toEqual(3)
			}))

		test('calculated value', () =>
			withESDB({test: {Model: ESModelIntId}}, async eSDB => {
				const sampleWithoutId = {
					...sampleObject,
					id: undefined,
				}
				await expect(
					eSDB.store.test.set(sampleWithoutId)
				).resolves.toHaveProperty('calc', 1)
				await expect(
					eSDB.store.test.update({myId: 1, calc: 5})
				).resolves.toHaveProperty('calc', 1)
			}))

		test('insertOnly', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await expect(
					Promise.all([
						eSDB.store.test.set(sampleObject, true),
						eSDB.store.test.set(sampleObject, true),
					])
				).rejects.toThrow('EEXIST')
			}))
	})

	describe('.update()', () => {
		test('works', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await eSDB.store.test.set(sampleObject)
				const newObject = {
					id: sampleObject.id,
					top: 'bottom',
					new: 'prop',
				}
				await eSDB.store.test.update(newObject)
				const items = await eSDB.store.test.all()
				expect(items).toHaveLength(1)
				expect(items[0]).toEqual({...sampleObject, ...newObject})
			}))

		test('without id', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await expect(eSDB.store.test.update({top: 'kek'})).rejects.toThrow(
					'No ID specified'
				)
			}))

		test('undefined values', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await eSDB.store.test.set(sampleObject)
				expect(
					await eSDB.store.test.update({id: sampleObject.id, top: undefined})
				).toEqual({...sampleObject, top: undefined})
			}))

		test('non-existent object', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await expect(eSDB.store.test.update(sampleObject)).rejects.toThrow(
					'ENOENT'
				)
			}))

		test('upsert', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				expect(await eSDB.store.test.update(sampleObject, true)).toEqual(
					sampleObject
				)
			}))

		test('upsert without id', () =>
			withESDB({test: {Model: ESModelIntId}}, async eSDB => {
				expect(await eSDB.store.test.update({top: 'kek'}, true)).toEqual({
					myId: 1,
					top: 'kek',
					calc: 1,
				})
			}))
	})

	describe('.remove()', () => {
		test('remove by id', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await eSDB.store.test.set(sampleObject)
				expect(await eSDB.store.test.remove(sampleObject.id)).toEqual(true)
				expect(await eSDB.store.test.all()).toEqual([])
			}))

		test('remove by object', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await eSDB.store.test.set(sampleObject)
				expect(await eSDB.store.test.remove(sampleObject)).toEqual(true)
				expect(await eSDB.store.test.all()).toEqual([])
			}))

		test('remove by object without id', () =>
			withESDB({test: {Model: ESModel}}, async eSDB => {
				await eSDB.store.test.set(sampleObject)
				await expect(
					eSDB.store.test.remove({...sampleObject, id: undefined})
				).rejects.toThrow()
			}))
	})

	describe('preprocessor', () => {
		test('works', () => {
			let ok
			return withESDB(
				{
					m: {
						idCol: 'hi',
						reducer: args => {
							if (!args.model) return false
							if (
								args.event.type === args.model.TYPE &&
								args.event.data[1] === 'a'
							)
								ok = true
							return ESModel.reducer(args)
						},
					},
				},
				async eSDB => {
					const {m} = eSDB.store
					await m.set({hi: 'a', meep: 'moop'})
					expect(ok).toBe(true)
				}
			)
		})
	})

	describe('itemClass', () => {
		class Foo {
			getF() {
				return this.f
			}
		}

		test('set', () =>
			withESDB(
				{
					m: {
						Model: class extends ESModel {
							constructor(o) {
								super({...o, ItemClass: Foo})
							}
						},
					},
				},
				async eSDB => {
					const {m} = eSDB.store
					const setted = await m.set({id: 4, f: 'meep'})
					expect(setted instanceof Foo).toBe(true)
					expect(setted.getF()).toBe('meep')
				}
			))
	})

	describe('.getNextId()', () => {
		test('works', () =>
			withESDB({m: {columns: {id: {type: 'INTEGER'}}}}, async eSDB => {
				const {m} = eSDB.store
				await expect(m.getNextId()).resolves.toBe(1)
				await m.set({id: 1})
				await expect(m.getNextId()).resolves.toBe(2)
				await eSDB.dispatch(m.TYPE, [ESModel.INSERT, 5, {id: 5}])
				await expect(m.getNextId()).resolves.toBe(6)
			}))

		test('concurrent', () =>
			withESDB({m: {columns: {id: {type: 'INTEGER'}}}}, async eSDB => {
				const {m} = eSDB.store
				expect(await Promise.all([m.getNextId(), m.getNextId()])).toEqual([
					1, 2,
				])
			}))

		test('run in subevent', () =>
			withESDB(
				{
					test: {
						Model: class ESModelSubevents extends ESModel {
							constructor(options) {
								super({
									...options,
									columns: {
										id: {
											type: 'INTEGER',
										},
									},
								})
							}

							static async reducer(arg) {
								const {event, addEvent, model} = arg
								const result = (await super.reducer(arg)) || event.result || {}
								if (event.type === 'SUBEVENT') {
									return {
										ins: [{id: await model.getNextId(), fromSubevent: true}],
									}
								}
								if (
									result &&
									result.upd &&
									result.upd.some(e => e.triggerSub)
								) {
									addEvent('SUBEVENT')
								}
								return result
							}

							static async deriver({model, result}) {
								if (
									result &&
									result.upd &&
									result.upd.some(e => e.triggerSub)
								) {
									model.set({fromDeriver: true})
								}
							}
						},
					},
				},
				async eSDB => {
					await eSDB.store.test.set({name: 'id 1'})
					await eSDB.store.test.set({name: 'id 2'})
					await eSDB.store.test.set({name: 'id 3'})
					await eSDB.store.test.set({name: 'id 4'})
					await eSDB.store.test.set({name: 'id 5'})
					await eSDB.store.test.update({id: 1, triggerSub: 'oh yiss'})

					expect(await eSDB.store.test.get(6)).toHaveProperty(
						'fromDeriver',
						true
					)
					expect(await eSDB.store.test.get(7)).toHaveProperty(
						'fromSubevent',
						true
					)
				}
			))
	})

	describe('events', () => {
		test('work', () =>
			withESDB({m: {columns: {id: {type: 'INTEGER'}}}}, async eSDB => {
				const {m} = eSDB.store
				await m.set({meep: 'moop'})
				await m.update({id: 1, beep: 'boop'})
				await m.set({meep: 'moop'}, true)
				await m.update({id: 3, beep: 'boop'}, true)
				await m.remove(3)
				const events = await eSDB.results.all()
				expect(
					events.map(e => {
						e.ts = 0
						return e
					})
				).toMatchSnapshot()
			}))

		test('are updated', () =>
			withESDB(
				{m: {idCol: 'v', columns: {v: {type: 'INTEGER'}}}},
				async eSDB => {
					const {m} = eSDB.store
					expect(await m.set({meep: 'moop'})).toEqual({v: 1, meep: 'moop'})
					expect(await m.set({v: 1, meep: 'moop'})).toEqual({
						v: 1,
						meep: 'moop',
					})
					expect(await m.set({v: 1, beep: 'boop', a: [null, 3]})).toEqual({
						v: 1,
						beep: 'boop',
						a: [null, 3],
					})
					expect(await m.update({v: 1, beep: 'boop'})).toEqual({
						v: 1,
						beep: 'boop',
						a: [null, 3],
					})
					expect(await m.update({v: 1, beep: 'foop', a: [null, 3]})).toEqual({
						v: 1,
						beep: 'foop',
						a: [null, 3],
					})
					const events = await eSDB.results.all()
					expect(
						events.map(e => {
							e.ts = 0
							return e
						})
					).toMatchSnapshot()
				}
			))

		test('hold metadata', () =>
			withESDB({m: {columns: {id: {type: 'INTEGER'}}}}, async eSDB => {
				const {m} = eSDB.store
				await m.set({meep: 'moop'}, null, true, {meta: 1})
				await m.update({id: 1, beep: 'boop'}, null, true, {meta: 2})
				await m.set({meep: 'moop'}, true, true, {meta: 3})
				await m.update({id: 3, beep: 'boop'}, true, true, 'hi')
				await m.set({})
				await m.remove(3, {meta: 4})
				await m.remove(2)
				const events = await eSDB.results.all()
				expect(events[0].data).toHaveLength(4)
				expect(events[4].data).toHaveLength(3)
				expect(events[6].data).toHaveLength(2)
				expect(events.map(e => e.data[3])).toEqual([
					{meta: 1},
					{meta: 2},
					{meta: 3},
					'hi',
					undefined,
					{meta: 4},
					undefined,
				])
			}))

		describe('event creators', () => {
			const fake = {
				registerMigrations: () => {},
				on: () => {},
				setMaxListeners: () => 10,
				getMaxListeners: () => 10,
			}
			const m = new ESModel({
				name: 'hi',
				db: fake,
				emitter: fake,
			})
			test.each([
				[
					'set',
					[{foo: true}],
					{type: 'es/hi', data: [ESModel.SET, null, {foo: true}]},
				],
				[
					'set',
					[{id: 'hi', bar: true}, true, {meta: 'hello'}],
					{
						type: 'es/hi',
						data: [
							ESModel.INSERT,
							null,
							{id: 'hi', bar: true},
							{meta: 'hello'},
						],
					},
				],
				[
					'update',
					[{id: 7, foo: true, bar: undefined}],
					{
						type: 'es/hi',
						data: [ESModel.UPDATE, null, {id: 7, foo: true, bar: null}],
					},
				],
				[
					'update', // with upsert
					[{foo: true}, true],
					{type: 'es/hi', data: [ESModel.SAVE, null, {foo: true}]},
				],
				[
					'remove',
					[{id: 'hi', f: 1}],
					{type: 'es/hi', data: [ESModel.REMOVE, 'hi']},
				],
				['remove', [7], {type: 'es/hi', data: [ESModel.REMOVE, 7]}],
			])('.event.%s%O => %O', (action, input, output) =>
				expect(m.event[action](...input)).toEqual(output)
			)
		})
	})
})
