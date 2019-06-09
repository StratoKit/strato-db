import sysPath from 'path'
import tmp from 'tmp-promise'
import ESDB from '.'
import {testModels} from '../lib/_test-helpers'

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

// finding 1: journal = wal should be in a transaction
test('multiple ESDB', async () => {
	expect(await db2.getVersion()).toBe(0)
	await db1.dispatch('foo')
	expect(await db2.getVersion()).toBe(1)
})

// TODO subevent handlers must see intermediate state => use rwDb
// TODO verify that db doesn't see transaction changes in rwDb (use await in reducer)
// TODO getNextId should only work during transaction, should be separate concept, per-transaction state
// TODO 10 simulteneous opens of existing db file
// TODO 10 simulteneous opens of new db file/new queue file with >1 version
