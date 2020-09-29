import DB from '../DB'
import ESDB from '../EventSourcingDB'
import EQ from '../EventQueue'
import JsonModel from '../JsonModel'

export {DB, JsonModel}

export const getModel = options => {
	const db = new DB()
	return db.addModel(JsonModel, {
		name: 'testing',
		keepRowId: false,
		...options,
	})
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
					// eslint-disable-next-line jest/no-standalone-expect
					expect(db).toBeTruthy()
					// eslint-disable-next-line jest/no-standalone-expect
					expect(queue).toBeTruthy()
					return model.set({id: 'count', total: 0, byType: {}})
				},
			},
		},
		preprocessor: async ({event}) => {
			if (event.type === 'error_pre') throw new Error('pre error for you')
		},
		reducer: async ({model, event: {type}}) => {
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
		// eslint-disable-next-line no-unused-vars
		reducer: args => {},
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
	await Promise.all([db.close(), queue.db.close()])
	return ret
}

/**
 * @param {Record<string,any>|function} modelsOrFn
 * @param {function} [fn]
 */
export const withESDB = (modelsOrFn, fn) => {
	let models
	if (typeof modelsOrFn === 'function') {
		// eslint-disable-next-line no-throw-literal
		if (fn) throw 'Use either .withESDB(fn) or .withESDB(models, fn)'
		fn = modelsOrFn
	} else {
		models = modelsOrFn
	}
	if (!models) models = testModels
	if (!fn) throw new Error('no fn passed to withESDB')
	return withDBs(async (db, queue) => {
		const eSDB = new ESDB({queue, models, name: 'E'})
		const out = await fn(eSDB, queue)
		await eSDB.close()
		return out
	})
}
