import sysPath from 'path'
import tmp from 'tmp-promise'
import ESDB from '.'
import {withESDB, testModels} from '../lib/_test-helpers'

test('queue in same db', async () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const eSDB = new ESDB({
				file,
				name: 'E',
				models: testModels,
			})
			const {queue} = eSDB
			queue.add('boop')
			const {v} = await queue.add('moop')
			eSDB.checkForEvents()
			await eSDB.handledVersion(v)
			const history = await eSDB.queue.all()
			expect(history).toHaveLength(2)
			expect(history[0].type).toBe('boop')
			expect(history[0].result).toBeTruthy()
			expect(history[1].type).toBe('moop')
			expect(history[1].result).toBeTruthy()
			await eSDB.dispatch('YO')
		},
		{unsafeCleanup: true}
	))

test('waitForQueue', async () =>
	withESDB(async (eSDB, queue) => {
		await expect(eSDB.waitForQueue()).resolves.toBeFalsy()
		await queue.add('1')
		await queue.add('2')
		expect(await eSDB.getVersion()).toBe(0)
		const p = eSDB.waitForQueue()
		let lastP
		for (let i = 3; i <= 10; i++) lastP = queue.add(String(i))
		const num = Number((await p).type)
		// should be at least last awaited
		expect(num).toBeGreaterThanOrEqual(2)
		await lastP
		await expect(eSDB.waitForQueue()).resolves.toHaveProperty('type', '10')
		// This should return immediately, if not the test will time out
		await expect(eSDB.waitForQueue()).resolves.toHaveProperty('type', '10')
	}))

test('waitForQueue race', async () =>
	withESDB(async (eSDB, queue) => {
		queue.add('1')
		queue.add('2')
		eSDB.waitForQueue()
		queue.add('3')
		await eSDB.handledVersion(3)
		await eSDB.handledVersion(3)
		queue.add('4')
		queue.add('5')
		queue.add('6')
		eSDB.waitForQueue()
		await eSDB.handledVersion(3)
		await eSDB.handledVersion(3)
		queue.add('7')
		eSDB.waitForQueue()
		await eSDB.waitForQueue()
		queue.add('8')
		queue.add('9')
		await eSDB.handledVersion(9)
		await eSDB.handledVersion(9)
		queue.add('10')
		queue.add('11')
		queue.add('12')
		const p = eSDB.handledVersion(12)
		eSDB.startPolling(12)
		expect(await p).toBeTruthy()
	}))

test('incoming event', async () => {
	return withESDB(async eSDB => {
		const event = await eSDB.queue.add('foobar')
		await eSDB.handledVersion(event.v)
		expect(await eSDB.store.count.get('count')).toEqual({
			id: 'count',
			total: 1,
			byType: {foobar: 1},
		})
	})
})
