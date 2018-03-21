import DB from '../DB'
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
