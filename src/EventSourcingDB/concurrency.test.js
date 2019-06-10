import sysPath from 'path'
import tmp from 'tmp-promise'
import ESDB from '.'

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
// TODO verify that db doesn't see transaction changes in rwDb (use await in reducer)
// TODO getNextId should only work during transaction, should be separate concept, per-transaction state
// TODO 10 simulteneous opens of existing db file
// TODO 10 simulteneous opens of new db file/new queue file with >1 version
