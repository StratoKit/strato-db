import sysPath from 'path'
import tmp from 'tmp-promise'
import {DB, JsonModel, getModel} from '../lib/_test-helpers'

test('falsy migration', async () => {
	const m = getModel({
		migrations: {
			foo: false,
		},
	})
	await expect(() => m.searchOne()).not.toThrow()
})

test('migrations', async () => {
	const m = getModel({
		columns: {
			foo: {
				type: 'NUMERIC',
				value: () => 5,
				get: true,
			},
		},
		migrations: {
			meep: async ({db, model, hi}) => {
				expect(db).toBeTruthy()
				expect(model).toBeTruthy()
				expect(hi).toBe(3)
				const d = await model.set({foo: 1})
				expect(d.foo).toBe(5)
				// This creates a prepared statement which must not leak
				expect(await model.get(d.id)).toHaveProperty('foo', 5)
			},
		},
		migrationOptions: {
			hi: 3,
			db: false,
		},
	})
	const d = await m.searchOne()
	expect(d.foo).toBe(5)
	// This should create a new prepared statement
	expect(await m.get(d.id)).toHaveProperty('foo', 5)
})

test('concurrent migrations', async () => {
	const db = new DB()
	const a = db.addModel(JsonModel, {
		name: 'a',
		migrations: {
			2: {
				async up({db: mDb}) {
					expect(await mDb.store.b.searchOne()).toEqual({id: '1'})
				},
			},
		},
	})
	db.addModel(JsonModel, {
		name: 'b',
		migrations: {
			1: {
				up({model}) {
					return model.set({id: 1})
				},
			},
		},
	})
	await a.searchOne()
})

test('migration clones writeable', async () => {
	const m = getModel({
		name: 'test',
		migrations: {
			foo1: ({model}) => {
				model.__temp = 123
			},
			foo2: ({db}) => {
				expect(db.store.test).toHaveProperty('__temp', 123)
			},
		},
	})
	await expect(m.db.store.test).not.toHaveProperty('__temp')
})

test('column add', () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const m1 = new DB({file}).addModel(JsonModel, {name: 'testing'})
			await m1.set({id: 'a', foo: {hi: true}})
			expect(await m1.db.get(`select * from testing`)).not.toHaveProperty('foo')
			await m1.db.close()
			const m2 = new DB({file}).addModel(JsonModel, {
				name: 'testing',
				columns: {foo: {type: 'JSON'}},
			})
			expect(await m2.get('a')).toHaveProperty('foo.hi')
			await m2.set({id: 'a', foo: {hello: true}})
			const a = await m2.get('a')
			expect(a).not.toHaveProperty('foo.hi')
			expect(a).toHaveProperty('foo.hello')
			expect(await m2.db.get(`select * from testing`)).toHaveProperty('foo')
		},
		{unsafeCleanup: true, prefix: 'jm-coladd'}
	))

test('failed migration', async () => {
	const m = getModel({
		name: 'test',
		migrations: {
			fail: async ({model}) => {
				await model.set({id: 'hi'})
				throw new Error('oh no')
			},
		},
	})
	await expect(m.db.store.test.get('id')).rejects.toThrow('oh no')
	expect(m.db.isOpen).toBe(false)
})
