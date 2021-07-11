export /**
 *	Execute all fn (asynchronously), if fn returns values, it returns the first result
 *
 * @param {[objects]} items
 * @param {function} fn
 * @returns {any} first positive result
 */
const settleAllFindFirst = async (items, fn) => {
	let err
	const results = await Promise.all(
		items.map(async i => {
			try {
				const res = await fn(i)
				if (res) return res
			} catch (error) {
				// last one wins
				err = error
			}
		})
	)
	if (err) throw err
	if (results?.filter(Boolean).length) return results[0]
	return false
}
