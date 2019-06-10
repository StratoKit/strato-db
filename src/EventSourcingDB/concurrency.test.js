import sysPath from 'path'
import tmp from 'tmp-promise'
import ESDB from '.'

let resolveMe, waitP

const testModels = {
	subber: {
		preprocessor: async ({model, store, event}) => {
			expect(model).toBe(store.subber)
			if (event.type === 'sub') expect(await model.get('hey')).toBeTruthy()
		},
		reducer: async (model, {type}, {dispatch, store}) => {
			expect(model).toBe(store.subber)
			switch (type) {
				case 'main':
					dispatch('sub')
					return {ins: [{id: 'hey'}]}
				case 'sub':
					expect(await model.get('hey')).toBeTruthy()
					break
				default:
			}
		},
	},
	waiter: {
		reducer: async (model, {type, data}) => {
			if (type === 'waiter') {
				return {ins: [data]}
			}
		},
		deriver: async ({event}) => {
			if (event.type === 'waiter') {
				resolveMe()
				resolveMe = null
				await waitP
				waitP = null
			}
		},
	},
}

let dir
let db1
let db2
beforeAll(async () => {
	dir = await tmp.dir({unsafeCleanup: true, prefix: 'esdb-concurrent-'})
	const {path} = dir
	const file = sysPath.join(path, 'db')
	const queueFile = sysPath.join(path, 'q')
	db1 = new ESDB({
		file,
		queueFile,
		name: 'E',
		models: testModels,
	})
	db2 = new ESDB({
		file,
		queueFile,
		name: 'E',
		models: testModels,
	})
	await db1.waitForQueue()
	await db2.waitForQueue()
})
afterAll(async () => {
	await dir.cleanup()
	await db1.close()
	await db2.close()
})

test('multiple ESDB', async () => {
	expect(await db2.getVersion()).toBe(0)
	await db1.dispatch('foo')
	expect(await db2.getVersion()).toBe(1)
})

test('subevent handlers see intermediate state', async () => {
	await db1._dispatchWithError('main')
})

test(`RO and other DB don't see transaction`, async () => {
	const firstP = new Promise(resolve => {
		resolveMe = resolve
	})
	let resolveSecond
	waitP = new Promise(resolve => {
		resolveSecond = resolve
	})
	const eventP = db1.dispatch('waiter', {id: 'w'})
	await firstP
	const v = await db1.getVersion()
	expect(await db1.rwStore.waiter.get('w')).toBeTruthy()
	expect(await db1.store.waiter.get('w')).toBeFalsy()
	expect(await db1.getVersion()).toBe(v)
	expect(await db2.rwStore.waiter.get('w')).toBeFalsy()
	expect(await db2.getVersion()).toBe(v)
	resolveSecond()
	const {v: v2} = await eventP
	expect(await db2.store.waiter.get('w')).toBeTruthy()
	await expect(v2).toBeGreaterThan(v)
})
// TODO getNextId should only work during transaction, should be separate concept, per-transaction state
// TODO 10 simulteneous opens of existing db file
// TODO 10 simulteneous opens of new db file/new queue file with >1 version
