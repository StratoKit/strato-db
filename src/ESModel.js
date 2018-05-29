// Drop-in replacement for JsonModel
// Caveats:
// * `.update()` returns the current object at the time of returning, not the one that was updated
//
import JsonModel from './JsonModel'

export const undefToNull = data => {
	if (data === undefined || data === null) {
		return null
	}
	if (typeof data !== 'object') {
		return data
	}
	if (Array.isArray(data)) {
		return data.map(undefToNull)
	}
	const out = {...data}
	Object.entries(out).forEach(([key, value]) => {
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

const REMOVE = 0
const SET = 1
const INSERT = 2
const UPDATE = 3
const SAVE = 4

class ESModel extends JsonModel {
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

	async set(obj, insertOnly) {
		if (this.writable) return super.set(obj, insertOnly)
		const {
			result: {[this.name]: r},
		} = await this.dispatch(this.TYPE, [insertOnly ? INSERT : SET, obj])
		const out = r && (r.ins ? r.ins[0] : r.set[0])
		return this.get(out[this.idCol])
	}

	async update(o, upsert) {
		if (this.writable) return super.update(o, upsert)
		let id = o[this.idCol]
		if (id == null && !upsert) {
			throw new TypeError('No ID specified')
		}
		const {result} = await this.dispatch(this.TYPE, [
			upsert ? SAVE : UPDATE,
			undefToNull(o),
		])
		if (id == null) {
			const r = result[this.name]
			const out = r && (r.ins ? r.ins[0] : r.upd[0])
			id = out && out[this.idCol]
		}
		// Note, his could return a later version of the object
		if (id) return this.get(id)
	}

	updateNoTrans(obj, upsert) {
		if (this.writable) return super.updateNoTrans(obj, upsert)
		throw new Error('Non-transactional changes are not possible with ESModel')
	}

	async remove(idOrObj) {
		if (this.writable) return super.remove(idOrObj)
		const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		if (id == null) throw new TypeError('No ID specified')
		await this.dispatch(this.TYPE, [REMOVE, id])
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
		this._maxId = 0
		return super.applyChanges(result)
	}

	static async reducer(model, {type, data}) {
		if (!model || type !== model.TYPE) return false

		let [action, obj] = data
		if (action === REMOVE) {
			if (await model.exists({[model.idCol]: obj})) return {rm: [obj]}
			return false
		}
		let id = obj[model.idCol]
		if (id == null) {
			id = await getId(model, obj)
			obj = {...obj, [model.idCol]: id}
		}
		const exists = await model.exists({[model.idCol]: id})
		switch (action) {
			case SET:
				return exists ? {set: [obj]} : {ins: [obj]}
			case INSERT:
				return exists ? {error: `object ${id} already exists`} : {ins: [obj]}
			case UPDATE:
				return exists ? {upd: [obj]} : {error: `object ${id} does not exist`}
			case SAVE:
				return exists ? {upd: [obj]} : {ins: [obj]}
			default:
				throw new TypeError('db action not found')
		}
	}
}

export default ESModel
