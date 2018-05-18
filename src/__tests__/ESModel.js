import ESModel, {getId} from '../ESModel'
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
			const result = await getId(eSDB.db.models.test, {top: 'kek'})
			expect(result).toBe(1)
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
		},
		{test: {Model: ESModelIntId}}
	))

test('set insertOnly', () =>
	withESDB(
		async eSDB => {
			expect(
				Promise.all([
					eSDB.db.models.test.set(sampleObject, true),
					eSDB.db.models.test.set(sampleObject, true),
					eSDB.db.models.test.set(sampleObject, true),
				])
			).rejects.toHaveProperty(
				'error._apply',
				'SQLITE_CONSTRAINT: UNIQUE constraint failed: test.id'
			)
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
		eSDB => {
			expect(eSDB.db.models.test.update({top: 'kek'})).rejects.toThrow(
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
			).toEqual(sampleObject) // same behaviour as JsonModel.update()
		},
		{test: {Model: ESModel}}
	))

test('update non-existent object', () =>
	withESDB(
		eSDB => {
			expect(eSDB.db.models.test.update(sampleObject)).rejects.toHaveProperty(
				'error._apply',
				'Missing object asd'
			)
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
			expect(
				eSDB.db.models.test.remove({...sampleObject, id: undefined})
			).rejects.toHaveProperty(
				'error._redux.message',
				"Cannot read property 'id' of undefined"
			)
		},
		{test: {Model: ESModel}}
	))
