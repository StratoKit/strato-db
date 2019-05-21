import {DB, JsonModel, getModel} from './_helpers'

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
			},
		},
		migrationOptions: {
			hi: 3,
			db: false,
		},
	})
	const d = await m.searchOne()
	expect(d.foo).toBe(5)
})

test('concurrent migrations', async () => {
	const db = new DB()
	const a = db.addModel(JsonModel, {
		name: 'a',
		migrations: {
			2: {
				async up({db}) {
					expect(await db.store.b.searchOne()).toEqual({id: '1'})
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
