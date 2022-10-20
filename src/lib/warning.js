export const DEV = process.env.NODE_ENV !== 'production'
export let deprecated, unknown

if (DEV) {
	const warned = {}
	const warner = type => (tag, msg, conditionFn) => {
		if (warned[tag]) return
		if (conditionFn && !conditionFn()) return
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
