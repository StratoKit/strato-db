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

class ESModel extends JsonModel {
	constructor({dispatch, ...options}) {
		super(options)
		this.dispatch = dispatch
		this.writeable = false
	}

	SET = `app/${this.name}/SET`

	UPD = `app/${this.name}/UPD`

	INS = `app/${this.name}/INS`

	RM = `app/${this.name}/RM`

	SAV = `app/${this.name}/SAV`

	setWriteable(state) {
		// Note: during writeable, no events are created. Be careful.
		this.writeable = state
	}

	async set(obj, insertOnly) {
		// Slight hack: use the writeable state to fall back to JsonModel behavior
		// This makes deriver work without changes
		if (this.writeable) return super.set(obj, insertOnly)
		const {result} = await this.dispatch(insertOnly ? this.INS : this.SET, obj)
		const {id} = result[this.name]
		if (id) return this.get(id)
	}

	async update(obj, upsert) {
		if (this.writeable) return super.update(obj, upsert)
		if (!obj[this.idCol] && !upsert) {
			throw new TypeError('No ID specified')
		}
		const {result} = await this.dispatch(
			upsert ? this.SAV : this.UPD,
			undefToNull(obj)
		)
		const {id} = result[this.name]
		if (id) return this.get(id)
	}

	updateNoTrans(obj, upsert) {
		if (this.writeable) return super.updateNoTrans(obj, upsert)
		throw new Error('Non-transactional changes are not possible with ESModel')
	}

	async remove(idOrObj) {
		if (this.writeable) return super.remove(idOrObj)
		const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
		await this.dispatch(this.RM, id)
		return true
	}

	_maxId = 0

	async getNextId() {
		if (!this._maxId) this._maxId = await this.max(this.idCol)
		return ++this._maxId
	}

	async applyChanges(result) {
		const {id, ...rest} = result
		this._maxId = 0
		return super.applyChanges(rest)
	}

	static async reducer(model, {type, data}) {
		if (!model) return false
		if (!type.startsWith(`app/${model.name}/`)) return false

		let dbAction

		switch (type) {
			case model.SET: {
				data[model.idCol] = await getId(model, data)
				dbAction = 'set'
				break
			}
			case model.UPD:
				dbAction = 'upd'
				break
			case model.INS:
				data[model.idCol] = await getId(model, data)
				dbAction = 'ins'
				break
			case model.RM:
				dbAction = 'rm'
				break
			case model.SAV:
				data[model.idCol] = await getId(model, data)
				dbAction = 'sav'
				break
			default:
				throw new TypeError('db action not found')
		}

		return {
			// We pass the id so our set etc can find it back quickly
			id: data[model.idCol],
			[dbAction]: [data],
		}
	}
}

export default ESModel
