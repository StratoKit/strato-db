// Only throw after all items are processed
export const settleAll = async (items, fn) => {
	let err
	await Promise.all(
		items.map(async i => {
			try {
				await fn(i)
			} catch (error) {
				// last one wins
				err = error
			}
		})
	)
	if (err) throw err
}
