// Drop-in replacement for JsonModel
// Caveats:
// * `.update()` returns the current object at the time of returning, not the one that was updated
//
// Events all type `es/name` and data `[actionEnum, id, obj]`
// The id is assigned by the preprocessor except for RM

import JsonModel from '../JsonModel'
import {DEV} from '../lib/warning'

export const undefToNull = data => {
	if (data == null) return null
	if (typeof data !== 'object') return data
	if (Array.isArray(data)) return data.map(undefToNull)
	if (Object.getPrototypeOf(data) !== Object.prototype) return data
	const out = {}
	Object.entries(data).forEach(([key, value]) => {
		out[key] = undefToNull(value)
	})
	return out
}

export const getId = async (model, data) => {
	let id = data[model.idCol]
	if (id == null) {
		// Be sure to call with model as this, like in JsonModel
		id = await model.columns[model.idCol].value.call(model, data)
	}
	// This can only happen for integer ids
	if (id == null) id = await model.getNextId()
	return id
}

class ESModel extends JsonModel {
	/* eslint-disable lines-between-class-members */
	static REMOVE = 0
	static SET = 1
	static INSERT = 2
	static UPDATE = 3
	static SAVE = 4
	/* eslint-enable lines-between-class-members */

	constructor({dispatch, ...options}) {
		super(options)
		this.dispatch = dispatch
		this.writable = false
	}

	TYPE = `es/${this.name}`

	setWritable(state) {
		// Slight hack: use the writable state to fall back to JsonModel behavior
		// This makes deriver and migrations work without changes
		// Note: during writable, no events are created. Be careful.
		this.writable = state
	}

	async set(obj, insertOnly, noReturn, meta) {
		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)
		if (this.writable) return super.set(obj, insertOnly, noReturn)

		const d = [insertOnly ? ESModel.INSERT : ESModel.SET, null, obj]
		if (meta) d[3] = meta

		const {
			data,
			// We know this is always present, our reducer always
			result: {[this.name]: r},
		} = await this.dispatch(this.TYPE, d)
		const id = data[1]

		if (r.esFail) throw new Error(`${this.name}.set ${id}: ${r.esFail}`)

		// We have to get because we don't know what calculated values did
		// Unfortunately, this might be the object after a later event
		return noReturn ? undefined : this.get(id)
	}

	async update(o, upsert, noReturn, meta) {
		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)

		if (this.writable) return super.update(o, upsert, noReturn)

		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)
		let id = o[this.idCol]
		if (id == null && !upsert) throw new TypeError('No ID specified')

		const d = [upsert ? ESModel.SAVE : ESModel.UPDATE, null, undefToNull(o)]
		if (meta) d.push(meta)

		const {
			data,
			result: {[this.name]: r},
		} = await this.dispatch(this.TYPE, d)
		id = data[1]

		if (r.esFail) throw new Error(`${this.name}.update ${id}: ${r.esFail}`)

		// We have to get because we don't know what calculated values did
		// Unfortunately, this might be the object after a later event
		return this.get(id)
	}

	updateNoTrans(obj, upsert) {
		if (this.writable) return super.updateNoTrans(obj, upsert)
		throw new Error('Non-transactional changes are not possible with ESModel')
	}

	async remove(idOrObj, meta) {
		if (this.writable) return super.remove(idOrObj)
		const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		if (id == null) throw new TypeError('No ID specified')

		const d = [ESModel.REMOVE, id]
		if (meta) d[3] = meta

		await this.dispatch(this.TYPE, d)
		return true
	}

	changeId() {
		throw new Error(`ESModel doesn't support changeId yet`)
	}

	_maxId = 0

	async getNextId() {
		if (!this._maxId) this._maxId = await this.max(this.idCol)
		return ++this._maxId
	}

	async applyChanges(result) {
		if (result.esFail) return
		this._maxId = 0
		return super.applyChanges({...result, esFail: undefined})
	}

	static async preprocessor({model, event}) {
		if (event.type !== model.TYPE) return
		if (event.data[0] > ESModel.REMOVE) {
			// Always overwrite, so repeat events get correct ids
			event.data[1] = await getId(model, event.data[2])
			return event
		}
	}

	static async reducer(model, {type, data}) {
		if (!model || type !== model.TYPE) return false

		let [action, id, obj] = data
		if (action === ESModel.REMOVE) {
			if (await model.exists({[model.idCol]: id})) return {rm: [id]}
			return false
		}

		if (obj[model.idCol] == null) obj = {...obj, [model.idCol]: id}

		const exists = await model.exists({[model.idCol]: id})

		switch (action) {
			case ESModel.SET:
				return exists ? {set: [obj]} : {ins: [obj]}
			case ESModel.INSERT:
				return exists ? {esFail: 'EEXIST'} : {ins: [obj]}
			case ESModel.UPDATE:
				return exists ? {upd: [obj]} : {esFail: 'ENOENT'}
			case ESModel.SAVE:
				return exists ? {upd: [obj]} : {ins: [obj]}
			default:
				throw new TypeError('db action not found')
		}
	}
}

export default ESModel
