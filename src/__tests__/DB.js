/* eslint-disable import/no-named-as-default-member */
import test from 'ava'
import BP from 'bluebird'
import DB, {sql} from '../DB'

test(`sql.quoteId`, t => {
	t.is(sql.quoteId('a"ha"h""a a a a"'), '"a""ha""h""""a a a a"""')
})
test('sql`` values', t => {
	const out = sql`values ${1}, ${'a'} bop`
	t.deepEqual(out, ['values ?, ? bop', [1, 'a']])
	t.deepEqual(sql`${5}`, ['?', [5]])
})
test('sql`` JSON', t => {
	const json = sql` ${'meep'}JSON, ${'moop'}JSONs, ${7}JSON`
	t.deepEqual(json, [' ?, ?JSONs, ?', ['"meep"', 'moop', '7']])
})
test('sql`` ID', t => {
	const out = sql`ids ${1}ID, ${2}IDs ${'a"meep"whee'}ID`
	t.deepEqual(out, ['ids "1", ?IDs "a""meep""whee"', [2]])
})
test('sql`` LIT', t => {
	const out = sql`ids ${1}LIT, ${2}LITs ${'a"meep"whee'}LIT`
	t.deepEqual(out, ['ids 1, ?LITs a"meep"whee', [2]])
})

test('sql`` on DB/db/fns', async t => {
	const db = new DB()
	t.is(typeof DB.sql, 'function')
	t.is(typeof db.sql, 'function')
	let p
	t.notThrows(() => {
		p = db.exec`CREATE TABLE ${'foo'}ID(id BLOB);`
	})
	await t.notThrows(p)
	t.notThrows(() => {
		p = db.run`INSERT INTO ${'foo'}ID VALUES (${5})`
	})
	await t.notThrows(p)
	t.notThrows(() => {
		p = db.get`SELECT * FROM ${'foo'}ID WHERE ${'id'}ID = ${5}`
	})
	const row = await p
	t.is(row.id, 5)
})

test('creates DB', async t => {
	const db = new DB()
	const version = await db.get('SELECT sqlite_version()')
	t.truthy(version['sqlite_version()'])
	t.deepEqual(db.models, {})
	await db.close()
})

test('readOnly', async t => {
	const db = new DB({readOnly: true})
	await t.notThrows(db.get('SELECT sqlite_version()'))
	await t.throws(db.get('CREATE TABLE foo(id)'))
	await db.close()
})

test('can register model', t => {
	const db = new DB()
	class Hi {
		name = 'hi'
	}
	const m = db.addModel(Hi)
	t.is(m.name, 'hi')
	t.is(db.models.hi, m)
	t.throws(() => db.addModel(Hi))
})

test('has migration', async t => {
	const db = new DB()
	db.registerMigrations('whee', {
		0: {
			up: db => {
				t.deepEqual(db.models, {})
				return db.exec(`
				CREATE TABLE foo(hi NUMBER);
				INSERT INTO foo VALUES (42);
			`)
			},
		},
	})
	const row = await db.get('SELECT * FROM foo')
	t.is(row.hi, 42)
	await db.close()
})

test('refuses late migrations', async t => {
	const db = new DB()
	db.registerMigrations('whee', {0: {up: () => {}}})
	await db.openDB()
	t.throws(() => db.registerMigrations('whee', {1: {up: () => {}}}))
	await db.close()
})

test('sorts migrations', async t => {
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
	t.deepEqual(arr, ['a', 'b', 'c'])
	await db.close()
})

test('marks migrations as ran', async t => {
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
	t.deepEqual(ran, {'a whee': true, 'b whee': true}) // eslint-disable-line camelcase
	await db.close()
})

test('each()', async t => {
	const db = new DB()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (42);
		INSERT INTO foo VALUES (43);
	`)
	const arr = []
	await db.each(`SELECT * FROM foo`, ({hi}) => arr.push(hi))
	t.deepEqual(arr, [42, 43])
})

test('close()', async t => {
	const db = new DB()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (42);
	`)
	const {hi} = await db.get(`SELECT * FROM foo`)
	t.is(hi, 42)
	// This clears db because it's in memory only
	await db.close()
	await db.exec(`
		CREATE TABLE foo(hi NUMBER);
		INSERT INTO foo VALUES (43);
	`)
	const {hi: hi2} = await db.get(`SELECT * FROM foo`)
	t.is(hi2, 43)
})

test.todo('downwards migration')

test('withTransaction', async t => {
	const db = new DB()
	await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
	db.withTransaction(async () => {
		await BP.delay(100)
		await db.exec`INSERT INTO foo VALUES (43, 1);`
	})
	await db.withTransaction(() => db.exec`UPDATE foo SET ho = 2 where hi = 43;`)
	t.deepEqual(await db.all`SELECT * from foo`, [{hi: 43, ho: 2}])
})

test('withTransaction rollback', async t => {
	const db = new DB()
	await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
	await t.throws(
		db.withTransaction(async () => {
			await db.exec`INSERT INTO foo VALUES (43, 1);`
			throw new Error('ignore this testing error')
		})
	)
	t.deepEqual(await db.all`SELECT * from foo`, [])
})

test.todo('withTransaction busy wait')
