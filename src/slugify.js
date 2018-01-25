import {deburr} from 'lodash'

const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const randomString = n =>
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
				: name && name[Object.keys(name)[0]]
	if (!t) {
		if (alwaysResult) return randomString(12)
		throw new Error(`Cannot slugify ${name}`)
	}
	return encodeURIComponent(deburr(t).trim())
		.replace(/(%..|[()])/g, '-')
		.replace(/--+/g, '-')
		.replace(/(^-|-$)/g, '')
		.slice(0, 30)
		.toLowerCase()
}

// This is not race-safe - only use for write-seldomn things like backoffice or inside transactions
export const uniqueSlugId = async (model, name, colName) => {
	const slug = slugifyString(name, true)
	let id = slug
	let i = 1
	// eslint-disable-next-line no-await-in-loop
	while (await model.exists({[colName]: id})) {
		id = `${slug}-${++i}`
	}
	return id
}
