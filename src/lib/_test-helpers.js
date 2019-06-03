import DB from '../DB'
import ESDB from '../EventSourcingDB'
import EQ from '../EventQueue'
import JsonModel from '../JsonModel'

export {DB, JsonModel}

export const getModel = options => {
	const db = new DB()
	return db.addModel(JsonModel, {name: 'testing', ...options})
}

export const sharedSetup = getPromise => fn => {
	let promise
	return async () => {
		if (!promise) {
			promise = getPromise()
		}
		return fn(await promise)
	}
}

export const testModels = {
	count: {
		// shortName: 'c',
		columns: {
			total: {type: 'INTEGER'},
		},
		migrations: {
			init: {
				up({db, model, queue}) {
					expect(db).toBeTruthy()
					expect(queue).toBeTruthy()
					return model.set({id: 'count', total: 0, byType: {}})
				},
			},
		},
		preprocessor: async ({event}) => {
			if (event.type === 'error_pre') throw new Error('pre error for you')
		},
		reducer: async (model, {type}) => {
			if (type === 'error_reduce') throw new Error('error for you')
			if (!model.get) return false
			const c = (await model.get('count')) || {
				id: 'count',
				total: 0,
				byType: {},
			}
			c.total++
			c.byType[type] = (c.byType[type] || 0) + 1
			return {
				set: [c],
				// audit: '',
			}
		},
		deriver: async ({event}) => {
			if (event.type === 'error_derive') throw new Error('post error for you')
		},
	},
	ignorer: {
		reducer: (model = null) => model,
	},
	deriver: {
		deriver: async ({model, store, result, event}) => {
			if (result !== event.result[model.name]) {
				throw new Error('Expecting event.result as separate input')
			}
			if (event.result.count) {
				const currentCount = await store.count.get('count')
				await model.set({
					id: 'descCount',
					desc: `Total: ${currentCount.total}, seen types: ${Object.keys(
						currentCount.byType
					)}`,
				})
			}
		},
	},
}
const withDBs = async fn => {
	const db = new DB({name: 'D'})
	const queue = new EQ({
		db: new DB({name: 'Q'}),
		columns: {events: {type: 'JSON'}},
	})
	const ret = await fn(db, queue)
	await db.close()
	await queue.db.close()
	return ret
}
export const withESDB = (fn, models = testModels) =>
	withDBs((db, queue) => {
		const eSDB = new ESDB({queue, models, name: 'E'})
		return fn(eSDB, queue)
	})
