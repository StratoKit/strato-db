import DB from './DB'
import EventResults from './EventResults'

const getModel = options => {
	const db = new DB()
	return db.addModel(EventResults, options)
}

test('create w/ extra columns', async () => {
	const m = getModel({
		columns: {foo: {real: true, value: () => 5, get: true}},
	})
	expect(await m.set({version: '1'})).toHaveProperty('foo', 5)
})

test('allow JsonModel migrations', async () => {
	const m = getModel({
		migrations: {
			test({model}) {
				return model.set({version: '2'})
			},
		},
	})
	const e = await m.get('2')
	expect(e.v).toBe(2)
})

test('type query uses index', async () => {
	const m = getModel()
	expect(
		await m.db.get(
			`EXPLAIN QUERY PLAN SELECT type FROM "${m.name}" where type='foo'`
		)
	).toHaveProperty('detail', expect.stringContaining('USING COVERING INDEX'))
})
