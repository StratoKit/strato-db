import {v1} from 'uuid'
import {uniqueSlugId} from '../lib/slugify'

const makeDefaultIdValue = idCol => obj => {
	if (obj[idCol] != null) return obj[idCol]
	return v1()
}

export const makeIdValue = (idCol, {value, slugValue, type} = {}) => {
	if (type === 'INTEGER') {
		// eslint-disable-next-line unicorn/prefer-logical-operator-over-ternary
		return value
			? value
			: o => {
					const id = o[idCol]
					return id || id === 0 ? id : null
			  }
	}
	// do not bind the value functions, they must be able to use other db during migrations
	if (slugValue) {
		return async function (o) {
			if (o[idCol] != null) return o[idCol]
			return uniqueSlugId(this, await slugValue(o), idCol)
		}
	}
	const defaultIdValue = makeDefaultIdValue(idCol)
	if (value) {
		return async function (o) {
			if (o[idCol] != null) return o[idCol]
			const id = await value.call(this, o)
			return id == null ? defaultIdValue(o) : id
		}
	}
	return defaultIdValue
}
