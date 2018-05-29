import ESModel, {undefToNull, getId} from '../ESModel'
import {withESDB} from './_helpers'

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
			const result = await eSDB.db.models.test.all()
			expect(result).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('getId standard settings', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.db.models.test, {top: 'kek'})).toBeTruthy()
		},
		{test: {Model: ESModel}}
	))

test('getId custom idCol', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.db.models.test, {top: 'kek'})).toBeTruthy()
		},
		{test: {Model: ESModelCustomId}}
	))

test('getId integer idCol', () =>
	withESDB(
		async eSDB => {
			expect(await getId(eSDB.db.models.test, {top: 'kek'})).toBe(1)
			expect(await getId(eSDB.db.models.test, {top: 'kek'})).toBe(2)
			await eSDB.db.models.test.set({myId: 7, asd: 'dsa'})
			expect(await getId(eSDB.db.models.test, {moop: 'meep'})).toBe(8)
		},
		{
			test: {Model: ESModelIntId},
		}
	))

test('set w/ id', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.db.models.test.set(sampleObject)).toEqual(sampleObject)
		},
		{test: {Model: ESModel}}
	))

test('set w/o id', () =>
	withESDB(
		async eSDB => {
			const newObject = await eSDB.db.models.test.set({
				...sampleObject,
				id: undefined,
			})
			expect(await eSDB.db.models.test.get(newObject.id)).toEqual(newObject)
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
				eSDB.db.models.test.set(sampleWithoutId),
				eSDB.db.models.test.set(sampleWithoutId),
				eSDB.db.models.test.set(sampleWithoutId),
			])
			expect(await getId(eSDB.db.models.test, {top: 'kek'})).toEqual(4)
			expect(await eSDB.db.models.test.count()).toEqual(3)
		},
		{test: {Model: ESModelIntId}}
	))

test('set insertOnly', () =>
	withESDB(
		async eSDB => {
			await expect(
				Promise.all([
					eSDB.db.models.test.set(sampleObject, true),
					eSDB.db.models.test.set(sampleObject, true),
				])
			).rejects.toHaveProperty('error.test')
		},
		{test: {Model: ESModel}}
	))

test('update', () =>
	withESDB(
		async eSDB => {
			await eSDB.db.models.test.set(sampleObject)
			const newObject = {
				id: sampleObject.id,
				top: 'bottom',
				new: 'prop',
			}
			await eSDB.db.models.test.update(newObject)
			const items = await eSDB.db.models.test.all()
			expect(items).toHaveLength(1)
			expect(items[0]).toEqual({...sampleObject, ...newObject})
		},
		{test: {Model: ESModel}}
	))

test('update w/o id', () =>
	withESDB(
		async eSDB => {
			await expect(eSDB.db.models.test.update({top: 'kek'})).rejects.toThrow(
				'No ID specified'
			)
		},
		{test: {Model: ESModel}}
	))

test('update w/ undefined values', () =>
	withESDB(
		async eSDB => {
			await eSDB.db.models.test.set(sampleObject)
			expect(
				await eSDB.db.models.test.update({id: sampleObject.id, top: undefined})
			).toEqual({...sampleObject, top: null}) // we cannot pass undefined here
		},
		{test: {Model: ESModel}}
	))

test('update non-existent object', () =>
	withESDB(
		async eSDB => {
			await expect(
				eSDB.db.models.test.update(sampleObject)
			).rejects.toHaveProperty('error.test')
		},
		{test: {Model: ESModel}}
	))

test('update upsert', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.db.models.test.update(sampleObject, true)).toEqual(
				sampleObject
			)
		},
		{test: {Model: ESModel}}
	))

test('update upsert w/o id', () =>
	withESDB(
		async eSDB => {
			expect(await eSDB.db.models.test.update({top: 'kek'}, true)).toEqual({
				myId: 1,
				top: 'kek',
			})
		},
		{test: {Model: ESModelIntId}}
	))

test('remove by id', () =>
	withESDB(
		async eSDB => {
			await eSDB.db.models.test.set(sampleObject)
			expect(await eSDB.db.models.test.remove(sampleObject.id)).toEqual(true)
			expect(await eSDB.db.models.test.all()).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('remove by object', () =>
	withESDB(
		async eSDB => {
			await eSDB.db.models.test.set(sampleObject)
			expect(await eSDB.db.models.test.remove(sampleObject)).toEqual(true)
			expect(await eSDB.db.models.test.all()).toEqual([])
		},
		{test: {Model: ESModel}}
	))

test('remove by object without id', () =>
	withESDB(
		async eSDB => {
			await eSDB.db.models.test.set(sampleObject)
			await expect(
				eSDB.db.models.test.remove({...sampleObject, id: undefined})
			).rejects.toThrow()
		},
		{test: {Model: ESModel}}
	))

class Foo {
	getF() {
		return this.f
	}
}

test('ItemClass set', async () =>
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
