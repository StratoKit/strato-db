import sysPath from 'path'
import tmp from 'tmp-promise'
import {chmod} from 'fs-extra'
import ESDB from '.'
import {testModels} from '../lib/_test-helpers'

test('open eSDB read-only separate queue', () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const queueFile = sysPath.join(dir, 'q')
			const eSDB = new ESDB({
				file,
				queueFile,
				name: 'E',
				models: testModels,
			})
			await eSDB.dispatch('foo')
			await eSDB.queue.db.exec('PRAGMA journal_mode=DELETE;')
			await eSDB.db.close()
			await eSDB.rwDb.exec('PRAGMA journal_mode=DELETE;')
			await eSDB.rwDb.close()

			await chmod(file, 0o400)
			await chmod(queueFile, 0o400)
			await chmod(sysPath.dirname(queueFile), 0o500)

			const roDB = new ESDB({
				file,
				queueFile,
				readOnly: true,
				name: 'E',
				models: testModels,
			})
			expect(await roDB.store.count.all()).toEqual([
				{id: 'count', total: 1, byType: {foo: 1}},
			])
			await expect(roDB.dispatch('foo')).rejects.toThrow('read')
			await chmod(sysPath.dirname(file), 0o700)
		},
		{unsafeCleanup: true}
	))

test('open eSDB read-only same queue', () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const eSDB = new ESDB({
				file,
				name: 'E',
				models: testModels,
			})
			await eSDB.dispatch('foo')
			await eSDB.queue.db.close()
			await eSDB.db.close()
			await eSDB.rwDb.exec('PRAGMA journal_mode=DELETE;')
			await eSDB.rwDb.close()

			await chmod(file, 0o400)
			await chmod(sysPath.dirname(file), 0o500)

			const roDB = new ESDB({
				file,
				readOnly: true,
				name: 'E',
				models: testModels,
			})
			expect(await roDB.store.count.all()).toEqual([
				{id: 'count', total: 1, byType: {foo: 1}},
			])
			await expect(roDB.dispatch('foo')).rejects.toThrow('read')
			await chmod(sysPath.dirname(file), 0o700)
		},
		{unsafeCleanup: true}
	))
