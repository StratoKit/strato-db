import {deburr} from 'lodash'
import uuid from 'uuid'

export const slugifyString = name => {
	// extract name from i18n objects
	const t = typeof name === 'string' ? name : name && name[Object.keys(name)[0]]
	if (!t) throw new Error(`Cannot slugify ${name}`)
	return encodeURIComponent(deburr(t).trim())
		.replace(/(%..|[()])/g, '-')
		.replace(/--+/g, '-')
		.replace(/(^-|-$)/g, '')
		.slice(0, 30)
		.toLowerCase()
}

// This is not race-safe - only use for write-seldomn things like backoffice
export const uniqueSlugId = async (model, name, colName) => {
	const slug = slugifyString(name)
	if (!slug) return uuid.v1()
	let id = slug
	let i = 1
	// eslint-disable-next-line no-await-in-loop
	while (await model.exists({[colName]: id})) {
		id = `${slug}-${++i}`
	}
	return id
}
