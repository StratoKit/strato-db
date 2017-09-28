import test from 'ava'
import {DB, JsonModel, getModel} from './_helpers'

test('falsy migration', async t => {
	const m = getModel({
		migrations: {
			foo: false,
		},
	})
	await t.notThrows(() => m.searchOne())
})

test('migrations', async t => {
	const m = getModel({
		columns: {
			foo: {
				type: 'NUMERIC',
				value: () => 5,
				get: true,
			},
		},
		migrations: {
			meep: {
				up: async ({db, model, hi}) => {
					t.truthy(db)
					t.truthy(model)
					t.is(hi, 3)
					const d = await model.set({foo: 1})
					t.is(d.foo, 5)
				},
			},
		},
		migrationOptions: {
			hi: 3,
			db: false,
		},
	})
	const d = await m.searchOne()
	t.is(d.foo, 5)
})

test('concurrent migrations', async t => {
	const db = new DB()
	const a = db.addModel(JsonModel, {
		name: 'a',
		migrations: {
			2: {
				async up({db}) {
					t.deepEqual(await db.models.b.searchOne(), {id: '1'})
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
