import ESModel, {undefToNull, getId} from './ESModel'
import {withESDB} from './lib/_test-helpers'

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
			},
			idCol: 'myId',
		})
	}
}

const sampleObject = {id: 'asd', meep: 'moop', top: 'kek'}

test('undefToNull', () => {
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

test('create', () =>
	withESDB(
		async eSDB => {
			const result = await eSDB.store.test.all()
			expect(result).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('getId standard settings', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBeTruthy()
		},
		{test: {Model: ESModel}}
	))

test('getId custom idCol', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBeTruthy()
		},
		{test: {Model: ESModelCustomId}}
	))

test('getId integer idCol', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBe(1)
			expect(await getId(eSDB.store.test, {top: 'kek'})).toBe(2)
			await eSDB.store.test.set({myId: 7, asd: 'dsa'})
			expect(await getId(eSDB.store.test, {moop: 'meep'})).toBe(8)
		},
		{
			test: {Model: ESModelIntId},
		}
	))

test('set w/ id', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.store.test.set(sampleObject)).toEqual(sampleObject)
		},
		{test: {Model: ESModel}}
	))

test('set w/o id', () =>
	withESDB(
		async eSDB => {
			const newObject = await eSDB.store.test.set({
				...sampleObject,
				id: undefined,
			})
			expect(await eSDB.store.test.get(newObject.id)).toEqual(newObject)
		},
		{test: {Model: ESModel}}
	))

test('set w/o id int', () =>
	withESDB(
		async eSDB => {
			const sampleWithoutId = {
				sampleObject,
				id: undefined,
			}
			await Promise.all([
				eSDB.store.test.set(sampleWithoutId),
				eSDB.store.test.set(sampleWithoutId),
				eSDB.store.test.set(sampleWithoutId),
			])
			expect(await getId(eSDB.store.test, {top: 'kek'})).toEqual(4)
			expect(await eSDB.store.test.count()).toEqual(3)
		},
		{test: {Model: ESModelIntId}}
	))

test('set insertOnly', () =>
	withESDB(
		async eSDB => {
			await expect(
				Promise.all([
					eSDB.store.test.set(sampleObject, true),
					eSDB.store.test.set(sampleObject, true),
				])
			).rejects.toThrow('EEXIST')
		},
		{test: {Model: ESModel}}
	))

test('update', () =>
	withESDB(
		async eSDB => {
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
		},
		{test: {Model: ESModel}}
	))

test('update w/o id', () =>
	withESDB(
		async eSDB => {
			await expect(eSDB.store.test.update({top: 'kek'})).rejects.toThrow(
				'No ID specified'
			)
		},
		{test: {Model: ESModel}}
	))

test('update w/ undefined values', () =>
	withESDB(
		async eSDB => {
			await eSDB.store.test.set(sampleObject)
			expect(
				await eSDB.store.test.update({id: sampleObject.id, top: undefined})
			).toEqual({...sampleObject, top: null}) // we cannot pass undefined here
		},
		{test: {Model: ESModel}}
	))

test('update non-existent object', () =>
	withESDB(
		async eSDB => {
			await expect(eSDB.store.test.update(sampleObject)).rejects.toThrow(
				'ENOENT'
			)
		},
		{test: {Model: ESModel}}
	))

test('update upsert', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.store.test.update(sampleObject, true)).toEqual(
				sampleObject
			)
		},
		{test: {Model: ESModel}}
	))

test('update upsert w/o id', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.store.test.update({top: 'kek'}, true)).toEqual({
				myId: 1,
				top: 'kek',
			})
		},
		{test: {Model: ESModelIntId}}
	))

test('remove by id', () =>
	withESDB(
		async eSDB => {
			await eSDB.store.test.set(sampleObject)
			expect(await eSDB.store.test.remove(sampleObject.id)).toEqual(true)
			expect(await eSDB.store.test.all()).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('remove by object', () =>
	withESDB(
		async eSDB => {
			await eSDB.store.test.set(sampleObject)
			expect(await eSDB.store.test.remove(sampleObject)).toEqual(true)
			expect(await eSDB.store.test.all()).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('remove by object without id', () =>
	withESDB(
		async eSDB => {
			await eSDB.store.test.set(sampleObject)
			await expect(
				eSDB.store.test.remove({...sampleObject, id: undefined})
			).rejects.toThrow()
		},
		{test: {Model: ESModel}}
	))

class Foo {
	getF() {
		return this.f
	}
}

test('ItemClass set', () =>
	withESDB(
		async eSDB => {
			const {m} = eSDB.store
			const setted = await m.set({id: 4, f: 'meep'})
			expect(setted instanceof Foo).toBe(true)
			expect(setted.getF()).toBe('meep')
		},
		{
			m: {
				Model: class extends ESModel {
					constructor(o) {
						super({...o, ItemClass: Foo})
					}
				},
			},
		}
	))

test('preprocessor', () => {
	let ok
	return withESDB(
		async eSDB => {
			const {m} = eSDB.store
			await m.set({hi: 'a', meep: 'moop'})
			expect(ok).toBe(true)
		},
		{
			m: {
				idCol: 'hi',
				reducer: (model, event) => {
					if (!model) return false
					if (event.type === model.TYPE && event.data[1] === 'a') ok = true
					return ESModel.reducer(model, event)
				},
			},
		}
	)
})

test('events', () =>
	withESDB(
		async (eSDB, queue) => {
			const {m} = eSDB.store
			await m.set({meep: 'moop'})
			await m.update({id: 1, beep: 'boop'})
			await m.set({meep: 'moop'}, true)
			await m.update({id: 3, beep: 'boop'}, true)
			await m.remove(3)
			const events = await queue.all()
			expect(
				events.map(e => {
					e.ts = 0
					return e
				})
			).toMatchSnapshot()
		},
		{m: {columns: {id: {type: 'INTEGER'}}}}
	))

test('metadata in event', () =>
	withESDB(
		async (eSDB, queue) => {
			const {m} = eSDB.store
			await m.set({meep: 'moop'}, null, {meta: 1})
			await m.update({id: 1, beep: 'boop'}, null, {meta: 2})
			await m.set({meep: 'moop'}, true, {meta: 3})
			await m.update({id: 3, beep: 'boop'}, true, 'hi')
			await m.set({})
			await m.remove(3, {meta: 4})
			await m.remove(2)
			const events = await queue.all()
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
		},
		{m: {columns: {id: {type: 'INTEGER'}}}}
	))

test('getNextId', () =>
	withESDB(
		async eSDB => {
			const {m} = eSDB.store
			await expect(m.getNextId()).resolves.toBe(1)
			await m.set({id: 1})
			await expect(m.getNextId()).resolves.toBe(2)
		},
		{m: {columns: {id: {type: 'INTEGER'}}}}
	))
