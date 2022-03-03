export const DEV = process.env.NODE_ENV !== 'production'
export let deprecated, unknown

if (DEV) {
	const warned = {}
	const warner = type => (tag, msg) => {
		if (warned[tag]) return
		warned[tag] = true
		// eslint-disable-next-line no-console
		console.warn(new Error(`!!! ${type} ${msg}`))
	}
	deprecated = warner('DEPRECATED')
	unknown = warner('UNKNOWN')
} else {
	deprecated = () => {}
	unknown = () => {}
}
