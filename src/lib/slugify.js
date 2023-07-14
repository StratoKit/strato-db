import {deburr} from 'lodash'

const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const randomString = (/** @type {number} */ n) =>
	// eslint-disable-next-line unicorn/no-new-array
	Array.apply(null, new Array(n))
		.map(() => {
			return abc.charAt(Math.floor(Math.random() * abc.length))
		})
		.join('')

export const slugifyString = (name, alwaysResult) => {
	// extract name from i18n objects
	const t =
		typeof name === 'string'
			? name
			: typeof name === 'number'
			? name.toString()
			: name && typeof name === 'object'
			? Object.values(name).find(v => typeof v === 'string' && v)
			: null
	if (!t) {
		if (alwaysResult) return randomString(12)
		throw new Error(`Cannot slugify ${name}`)
	}
	return encodeURIComponent(deburr(t).trim())
		.replaceAll(/(%..|['()_~])/g, '-')
		.replaceAll(/--+/g, '-')
		.toLowerCase()
		.replaceAll(/(^[^\da-z]+|[^\da-z]+$)/g, '')
		.slice(0, 30)
}

// This is not race-safe - only use for write-seldomn things like backoffice or inside transactions
export const uniqueSlugId = async (model, name, colName, currentId) => {
	const slug = slugifyString(name, true)
	let id = slug
	let i = 1
	const where = currentId && {
		[`${model.idColQ} IS NOT ?`]: [currentId],
	}

	while (await model.exists({[colName]: id}, {where})) {
		id = `${slug}-${++i}`
	}
	return id
}
