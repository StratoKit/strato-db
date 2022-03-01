import {Sema} from 'async-sema'

// Only throw after all items are processed
/**
 * @param {Item[]} items
 * @param {(item: Item) => Promise<void> | void} fn
 * Function to call on each item.
 * @param {number} [maxConcurrent]
 * Maximum functions running in parallel.
 * @template Item
 */
export const settleAll = async (items, fn, maxConcurrent) => {
	let err, cb
	if (maxConcurrent) {
		const sema = new Sema(maxConcurrent)
		cb = async item => {
			await sema.acquire()
			try {
				return fn(item)
			} finally {
				sema.release()
			}
		}
	} else {
		cb = fn
	}
	await Promise.all(
		items.map(async i => {
			try {
				await cb(i)
			} catch (error) {
				// last one wins
				err = error
			}
		})
	)
	if (err) throw err
}
