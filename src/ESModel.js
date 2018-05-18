import JsonModel from './JsonModel'

const undefToNull = data => {
	if (typeof data !== 'object') return data
	const out = {...data}
	Object.entries(out).forEach(([key, value]) => {
		if (value === undefined) {
			out[key] = null
		} else if (Array.isArray(value)) {
			out[key] = value.map(undefToNull)
		} else if (typeof value === 'object') {
			out[key] = undefToNull(value)
		}
	})
	return out
}

const DEV = process.env.NODE_ENV !== 'production'
let unknown
if (DEV) {
	const warned = {}
	const warner = type => (tag, msg) => {
		if (warned[tag]) return
		warned[tag] = true
		// eslint-disable-next-line no-console
		console.error(new Error(`!!! ${type} ${msg}`))
	}
	unknown = warner('UNKNOWN')
}

export const getId = async (model, data) => {
	let id = data[model.idCol]
	if (id == null) id = await model.columns[model.idCol].value(data)
	// This can only happen for integer ids
	if (id == null) id = await model.getNextId()
	return id
}

class ESModel extends JsonModel {
	constructor({dispatch, ...options}) {
		super(options)
		this.dispatch = dispatch
	}

	SET = `app/${this.name}/SET`

	UPD = `app/${this.name}/UPD`

	INS = `app/${this.name}/INS`

	RM = `app/${this.name}/RM`

	SAV = `app/${this.name}/SAV`

	async set(obj, insertOnly) {
		const {result: {[this.name]: {id}}} = await this.dispatch(
			insertOnly ? this.INS : this.SET,
			obj
		)
		if (id) return this.get(id)
	}

	async update(obj, upsert) {
		if (!obj[this.idCol]) {
			throw new TypeError('No ID specified')
		}
		const {result: {[this.name]: {id}}} = await this.dispatch(
			upsert ? this.SAV : this.UPD,
			obj
		)
		if (id) return this.get(id)
	}

	updateNoTrans(obj, upsert) {
		return this.update(obj, upsert)
	}

	async remove(idOrObj) {
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
		const {rm, set, ins, upd, sav, id} = result
		if (DEV) {
			const {rm, set, ins, upd, sav, id, ...rest} = result
			Object.keys(rest).forEach(k => unknown(k, `key ${k} in result`))
		}
		if (rm) await Promise.all(rm.map(item => super.remove(item)))
		if (ins) await Promise.all(ins.map(obj => super.set(obj, true)))
		if (set) await Promise.all(set.map(obj => super.set(obj)))
		if (upd)
			await Promise.all(
				upd.map(async obj => {
					const id = obj[this.idCol]
					const prev = await this.get(id)
					if (!prev) throw new Error(`Missing object ${obj[this.idCol]}`)
					return super.set({...prev, ...obj})
				})
			)
		if (sav)
			await Promise.all(
				sav.map(async obj => {
					const id = obj[this.idCol]
					const prev = await this.get(id)
					return super.set({...prev, ...obj})
				})
			)
		this._maxId = 0
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
			id: data[model.idCol],
			[dbAction]: [data],
		}
	}
}

export default ESModel
