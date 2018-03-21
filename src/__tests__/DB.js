import expect from 'expect'
/* eslint-disable import/no-named-as-default-member */
import BP from 'bluebird'
import DB, {sql} from '../DB'

test(`sql.quoteId`, () => {
	expect(sql.quoteId('a"ha"h""a a a a"')).toBe('"a""ha""h""""a a a a"""')
})
test('sql`` values', () => {
	const out = sql`values ${1}, ${'a'} bop`
	expect(out).toEqual(['values ?, ? bop', [1, 'a']])
	expect(sql`${5}`).toEqual(['?', [5]])
})
test('sql`` JSON', () => {
	const json = sql` ${'meep'}JSON, ${'moop'}JSONs, ${7}JSON`
	expect(json).toEqual([' ?, ?JSONs, ?', ['"meep"', 'moop', '7']])
})
test('sql`` ID', () => {
	const out = sql`ids ${1}ID, ${2}IDs ${'a"meep"whee'}ID`
	expect(out).toEqual(['ids "1", ?IDs "a""meep""whee"', [2]])
})
test('sql`` LIT', () => {
	const out = sql`ids ${1}LIT, ${2}LITs ${'a"meep"whee'}LIT`
	expect(out).toEqual(['ids 1, ?LITs a"meep"whee', [2]])
})

test('sql`` on DB/db/fns', async () => {
	const db = new DB()
	expect(typeof DB.sql).toBe('function')
	expect(typeof db.sql).toBe('function')
	let p
	expect(() => {
		p = db.exec`CREATE TABLE ${'foo'}ID(id BLOB);`
	}).not.toThrow()
	await expect(p).resolves.not.toThrow()
	expect(() => {
		p = db.run`INSERT INTO ${'foo'}ID VALUES (${5})`
	}).not.toThrow()
	await expect(p).resolves.not.toThrow()
	expect(() => {
		p = db.get`SELECT * FROM ${'foo'}ID WHERE ${'id'}ID = ${5}`
	}).not.toThrow()
	const row = await p
	expect(row.id).toBe(5)
})

test('creates DB', async () => {
	const db = new DB()
	const version = await db.get('SELECT sqlite_version()')
	expect(version['sqlite_version()']).toBeTruthy()
	expect(db.models).toEqual({})
	await db.close()
})

test('readOnly', async () => {
	const db = new DB({readOnly: true})
	await expect(db.get('SELECT sqlite_version()')).resolves.toBeTruthy()
	await expect(db.get('CREATE TABLE foo(id)')).rejects.toThrow(
		'SQLITE_READONLY'
	)
	await db.close()
})

test('can register model', () => {
	const db = new DB()
	class Hi {
		name = 'hi'
	}
	const m = db.addModel(Hi)
	expect(m.name).toBe('hi')
	expect(db.models.hi).toBe(m)
	expect(() => db.addModel(Hi)).toThrow()
})

test('has migration', async () => {
	const db = new DB()
	db.registerMigrations('whee', {
		0: {
			up: db => {
				expect(db.models).toEqual({})
				return db.exec(`
				CREATE TABLE foo(hi NUMBER);
				INSERT INTO foo VALUES (42);
			`)
			},
		},
	})
	const row = await db.get('SELECT * FROM foo')
	expect(row.hi).toBe(42)
	await db.close()
})

test('refuses late migrations', async () => {
	const db = new DB()
	db.registerMigrations('whee', {0: {up: () => {}}})
	await db.openDB()
	expect(() => db.registerMigrations('whee', {1: {up: () => {}}})).toThrow()
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
	await db.openDB()
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
	await db.openDB()
	const ran = await db._getRanMigrations()
	expect(ran).toEqual({'a whee': true, 'b whee': true}) // eslint-disable-line camelcase
	await db.close()
})

test('each()', async () => {
	const db = new DB()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (42);
		INSERT INTO foo VALUES (43);
	`)
	const arr = []
	await db.each(`SELECT * FROM foo`, ({hi}) => arr.push(hi))
	expect(arr).toEqual([42, 43])
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
})

test.skip('downwards migration', () => {}) // TODO

test('withTransaction', async () => {
	const db = new DB()
	await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
	db.withTransaction(async () => {
		await BP.delay(100)
		await db.exec`INSERT INTO foo VALUES (43, 1);`
	})
	await db.withTransaction(() => db.exec`UPDATE foo SET ho = 2 where hi = 43;`)
	expect(await db.all`SELECT * from foo`).toEqual([{hi: 43, ho: 2}])
})

test('withTransaction rollback', async () => {
	const db = new DB()
	await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
	await expect(
		db.withTransaction(async () => {
			await db.exec`INSERT INTO foo VALUES (43, 1);`
			throw new Error('ignoreme')
		})
	).rejects.toThrow('ignoreme')
	expect(await db.all`SELECT * from foo`).toEqual([])
})

test.skip('withTransaction busy wait', () => {}) // TODO
