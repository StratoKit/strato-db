import DB from '.'
import tmp from 'tmp-promise'

test('prepares statement', async () => {
	const db = new DB()
	const s = db.prepare('SELECT 5')
	expect(await s.all()).toEqual([{5: 5}])
})

test('get resets', async () => {
	const db = new DB()
	const s = db.prepare('VALUES(1),(2)')
	expect(await s.get()).toEqual({column1: 1})
	expect(await s.get()).toEqual({column1: 1})
	await db.close()
})

test('finalizes only once', async () => {
	const db = new DB()
	const s = db.prepare('SELECT 5')
	await s.finalize()
	await expect(s.finalize()).resolves.toBe()
})

test('uses parameters', async () => {
	const db = new DB()
	const s = db.prepare('SELECT ?*IFNULL(?,2) AS v')
	expect(await s.get([5])).toEqual({v: 10})
	expect(await s.all([2, 4])).toEqual([{v: 8}])
	await db.close()
})

test('each()', async () => {
	const db = new DB()
	const s = db.prepare('VALUES(1),(2),(3)')
	await expect(s.each()).rejects.toThrow()
	let t = ''
	await expect(
		s.each([], r => {
			t += r.column1
		})
	).resolves.toBe(3)
	expect(t).toBe('123')
	await db.close()
})

test('handles db closure', () =>
	tmp.withFile(async ({path: file}) => {
		const db = new DB({file})
		await db.exec('CREATE TABLE foo(id INTEGER PRIMARY KEY)')
		const s = db.prepare('SELECT id FROM foo LIMIT 1')
		await db.exec('INSERT INTO foo VALUES (1)')
		expect(await s.get()).toEqual({id: 1})
		await expect(db.exec('INSERT INTO foo VALUES (1)')).rejects.toThrow(
			'SQLITE_CONSTRAINT'
		)
		await db.close()
		expect(await s.get()).toEqual({id: 1})
	}))

test('ignores previous failure', async () => {
	const db = new DB()
	await db.exec('CREATE TABLE foo(id INTEGER PRIMARY KEY)')
	const s = db.prepare('INSERT INTO foo VALUES (?)')
	await s.run([1])
	await expect(s.run([1])).rejects.toThrow()
	await expect(s.run([2])).resolves.toBeDefined()
})

// TODO test get, all, run, each with parallel reads (only one should run at a time)
