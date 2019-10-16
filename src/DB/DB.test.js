import sysPath from 'path'
import tmp from 'tmp-promise'
import DB, {_getRanMigrations} from './DB'

test('can register model', () => {
	const db = new DB()
	class Hi {
		name = 'hi'
	}
	const m = db.addModel(Hi)
	expect(m.name).toBe('hi')
	expect(db.store.hi).toBe(m)
	expect(() => db.addModel(Hi)).toThrow()
	return db.close()
})

test('has migration', async () => {
	const db = new DB()
	let canary = 0
	// eslint-disable-next-line promise/catch-or-return
	db.dbP.then(() => {
		// This should run after the migrations
		if (canary === 2) canary = 3
		return true
	})
	db.registerMigrations('whee', {
		0: {
			up: db => {
				if (canary === 0) canary = 1
				expect(db.store).toEqual({})
				return db.exec(`
				CREATE TABLE foo(hi NUMBER);
				INSERT INTO foo VALUES (42);
			`)
			},
		},
		1: db => {
			if (canary === 1) canary = 2
			return db.exec(`
				INSERT INTO foo VALUES (42);
			`)
		},
	})
	const row = await db.get('SELECT * FROM foo')
	expect(row.hi).toBe(42)
	expect(canary).toBe(3)
	await db.close()
})

test('refuses late migrations', async () => {
	const db = new DB()
	db.registerMigrations('whee', {0: {up: () => {}}})
	await db.open()
	expect(() => db.registerMigrations('whee', {1: {up: () => {}}})).toThrow()
	await db.close()
})

test('runs migrations in writable mode', async () => {
	const db = new DB()
	let f = 0
	db.registerMigrations('whee', {
		0() {
			if (f === 1) f = 2
		},
	})
	db.addModel(
		class T {
			setWritable(v) {
				if (v && f === 0) f = 1
				if (!v && f === 2) f = 3
			}
		}
	)
	await db.open()
	expect(f).toBe(3)
	await db.close()
})

test('sorts migrations', async () => {
	const db = new DB()
	const arr = []
	db.registerMigrations('whee', {
		c: {
			up: () => {
				arr.push('c')
			},
		},
	})
	db.registerMigrations('aah', {
		b: {
			up: () => {
				arr.push('b')
			},
		},
	})
	db.registerMigrations('whee', {
		a: {
			up: () => {
				arr.push('a')
			},
		},
	})
	await db.open()
	expect(arr).toEqual(['a', 'b', 'c'])
	await db.close()
})

test('marks migrations as ran', async () => {
	const db = new DB()
	const count = {a: 0, b: 0}
	db.registerMigrations('whee', {
		a: {
			up: () => {
				count.a++
			},
		},
	})
	db.registerMigrations('whee', {
		b: {
			up: () => {
				count.b++
			},
		},
	})
	await db.open()
	const ran = await _getRanMigrations(db)
	expect(ran).toEqual({'a whee': true, 'b whee': true})
	await db.close()
})

test('close()', async () => {
	const db = new DB()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (42);
	`)
	const {hi} = await db.get(`SELECT * FROM foo`)
	expect(hi).toBe(42)
	// This clears db because it's in memory only
	await db.close()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (43);
	`)
	const {hi: hi2} = await db.get(`SELECT * FROM foo`)
	expect(hi2).toBe(43)
	await db.close()
})

test('onWillOpen', async () => {
	let t = 0
	const db = new DB({
		onWillOpen() {
			if (t === 0) t = 1
		},
	})
	db.registerMigrations('meep', {
		c: {
			up: () => {
				if (t === 1) t = 2
			},
		},
	})
	await db.open()
	expect(t).toBe(2)
	await db.close()
})

test('10 simultaneous opens', async () =>
	tmp.withDir(
		async ({path: dir}) => {
			const file = sysPath.join(dir, 'db')
			const migrations = {
				0: async db => {
					await db.exec('CREATE TABLE t(id, v); INSERT INTO t VALUES(1, 0);')
				},
			}
			const db = new DB({file})
			db.registerMigrations('foo', migrations)

			const openClose = async () => {
				const db = new DB({file})
				db.registerMigrations('foo', migrations)
				await db.open()
				await db.exec('UPDATE t SET v=v+1 WHERE id=1')
				await db.close()
			}
			const Ps = []
			for (let i = 0; i < 10; i++) {
				Ps.push(openClose())
			}
			await Promise.all(Ps)
			expect(await db.get('SELECT v from t')).toHaveProperty('v', 10)
		},
		{unsafeCleanup: true, prefix: 'db-open'}
	))
