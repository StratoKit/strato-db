/* eslint-disable no-await-in-loop */
import sysPath from 'path'
import tmp from 'tmp-promise'
import ESDB from '.'

jest.setTimeout(60000)

const payload = JSON.stringify(require('../../package.json')).repeat(50)

let resolveMe, waitP

const testModels = {
	storer: {
		reducer: ({event}) => {
			if (event.type === 'ins') return {ins: [event.data]}
			if (event.type === 'upd') return {upd: [{...event.data, payload}]}
		},
	},
	subber: {
		preprocessor: async ({model, store, event}) => {
			expect(model).toBe(store.subber)
			if (event.type === 'sub') expect(await model.get('hey')).toBeTruthy()
		},
		reducer: async ({model, event: {type}, dispatch, store}) => {
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
		reducer: async ({event: {type, data}}) => {
			if (type === 'waiter') {
				return {ins: [data]}
			}
		},
		deriver: async ({event}) => {
			if (event.type === 'waiter') {
				resolveMe()
				resolveMe = null
				await waitP
				// eslint-disable-next-line require-atomic-updates
				waitP = null
			}
		},
	},
	nexter: {
		columns: {id: {type: 'INTEGER'}},
		reducer: async ({model, event: {type, data}, dispatch}) => {
			if (type !== 'nexter') return
			const id = await model.getNextId()
			await model.getNextId() // skip an id
			const id2 = await model.getNextId()
			// skip an id, shouldn't matter
			await model.getNextId()
			if (data) {
				dispatch('nexter', data - 1)
			}
			return {ins: [{id}, {id: id2}]}
		},
	},
}

const withDbs = fn => async () => {
	const dir = await tmp.dir({unsafeCleanup: true, prefix: 'esdb-concurrent-'})
	const {path} = dir
	const file = sysPath.join(path, 'db')
	const queueFile = sysPath.join(path, 'q')
	const db1 = new ESDB({
		file,
		queueFile,
		name: 'E',
		models: testModels,
	})
	const db2 = new ESDB({
		file,
		queueFile,
		name: 'E',
		models: testModels,
	})
	await db1.waitForQueue()
	await db2.waitForQueue()

	try {
		await fn({db1, db2})
	} finally {
		await db1.close()
		await db2.close()
		await dir.cleanup()
	}
}

test(
	'multiple ESDB',
	withDbs(async ({db1, db2}) => {
		let i = 1
		let v = 0
		do {
			let evP = db1.dispatch('ins', {id: i})
			expect(await db2.getVersion()).toBe(v)
			v = (await evP).v
			expect(await db2.getVersion()).toBe(v)
			evP = db1.dispatch('upd', {id: i++, hi: i})
			v = (await evP).v
			expect(await db2.getVersion()).toBe(v)
		} while (i <= 100)
		expect(v).toBe(200)
	})
)

// Sadly this test doesn't reproduce an issue seen in the wild:
// db not seeing the changes from rwDb right after they
// were committed. We have a fix but no repro.
// Leaving this test in anyway, just in case
test(
	'ro/rw db events',
	withDbs(async ({db1}) => {
		let i = 1
		let v = 0
		do {
			let evP = db1.dispatch('ins', {id: i})
			expect(await db1.db.userVersion()).toBe(v)
			v = (await evP).v
			expect(await db1.db.userVersion()).toBe(v)
			evP = db1.dispatch('upd', {id: i++, hi: i})
			v = (await evP).v
			expect(await db1.db.userVersion()).toBe(v)
		} while (i <= 200)
		expect(v).toBe(400)
	})
)

test(
	'subevent handlers see intermediate state',
	withDbs(async ({db1}) => {
		expect(await db1.dispatch('main')).toBeTruthy()
	})
)

test(
	`RO and other DB don't see transaction`,
	withDbs(async ({db1, db2}) => {
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
)

test(
	`getNextId should work across main and subevents`,
	withDbs(async ({db1}) => {
		await db1.dispatch('nexter', 1)
		await db1.dispatch('nexter', 1)
		expect(await db1.store.nexter.all()).toEqual([
			{id: 1},
			// skipped
			{id: 3},
			// skipped but recovered within transaction
			{id: 4},
			// skipped
			{id: 6},
			// skipped but recovered outside transaction
			{id: 7},
			// skipped
			{id: 9},
			// skipped but recovered within transaction
			{id: 10},
			// skipped
			{id: 12},
		])
	})
)

// TODO 10 simultaneous opens of existing db file
// TODO 10 simultaneous opens of new db file/new queue file with >1 version
// TODO 10 simultaneous worker connections on 100 events
