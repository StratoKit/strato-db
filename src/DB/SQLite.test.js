import sysPath from 'path'
import tmp from 'tmp-promise'
import SQLite, {sql, valToSql} from './SQLite'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('valToSql', () => {
	test.each([
		[true, '1'],
		[false, '0'],
		[0, '0'],
		[5.4, '5.4'],
		["h'i", "'h''i'"],
		[null, 'NULL'],
		[undefined, 'NULL'],
	])('%p => %s', (input, out) => {
		expect(valToSql(input)).toBe(out)
	})
})

describe('sql helper function', () => {
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
		const db = new SQLite()
		// eslint-disable-next-line import/no-named-as-default-member
		expect(typeof SQLite.sql).toBe('function')
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
		await db.close()
	})
})

const expectSqliteWorks = async db =>
	expect(await db.get('SELECT sqlite_version() AS v')).toHaveProperty('v')

describe('SQLite', () => {
	test('works', async () => {
		const db = new SQLite()
		await expectSqliteWorks(db)
		expect(db.isOpen).toBe(true)
		expect(db.dbP).toBeInstanceOf(Promise)
		expect(db.store).toEqual({})
		await db.close()
	})

	test('throws opening errors on any call', async () => {
		const db = new SQLite({
			onWillOpen: () => {
				throw new Error('no')
			},
		})
		await expect(db.exec('SELECT 1')).rejects.toThrow('no')
		await expect(db.close()).resolves.toBeFalsy()
	})

	test('closes when onDidOpen fails', async () => {
		const db = new SQLite({
			onDidOpen: () => {
				throw new Error('no')
			},
		})
		await expect(db.exec('SELECT 1')).rejects.toThrow('no')
		expect(db.isOpen).toBe(false)
	})

	test('10 simultaneous opens', async () => {
		tmp.withDir(
			async ({path: dir}) => {
				const file = sysPath.join(dir, 'db')
				const db = new SQLite({file})
				await db.exec('CREATE TABLE t(id, v); INSERT INTO t VALUES(1, 0);')

				const openClose = async () => {
					const db = new SQLite({file})
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
			{unsafeCleanup: true, prefix: 'sq-open'}
		)
	})
	test('.close()', async () => {
		const db = new SQLite()
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

	describe('.runOnceOnOpen()', () => {
		test('works before open', async () => {
			const db = new SQLite()
			const spy = jest.fn()
			expect(db.runOnceOnOpen(spy)).toBeFalsy()
			expect(spy).not.toHaveBeenCalled()
			await db.open()
			expect(spy).toHaveBeenCalledTimes(1)
			expect(spy).toHaveBeenCalledWith(expect.any(SQLite))
			await db.close()
			await db.open()
			expect(spy).toHaveBeenCalledTimes(1)
			await db.close()
		})

		test('works after open', async () => {
			const db = new SQLite()
			await db.open()
			const spy = jest.fn(() => 'hi')
			expect(db.runOnceOnOpen(spy)).toEqual('hi')
			expect(spy).toHaveBeenCalledWith(expect.any(SQLite))
			await db.close()
		})

		test('works for multiple', async () => {
			const db = new SQLite()
			const spy1 = jest.fn()
			const spy2 = jest.fn(() => expect(spy1).toHaveBeenCalledTimes(1))
			expect(db.runOnceOnOpen(spy1)).toBeFalsy()
			expect(db.runOnceOnOpen(spy2)).toBeFalsy()
			await db.open()
			expect(spy2).toHaveBeenCalledTimes(1)
			await db.close()
		})

		test('throws immediately when open', async () => {
			const db = new SQLite()
			await db.open()
			expect(() =>
				db.runOnceOnOpen(() => {
					// eslint-disable-next-line no-throw-literal
					throw 'hi'
				})
			).toThrow('hi')
			await db.close()
		})

		test('throws on open', async () => {
			const db = new SQLite()
			expect(() =>
				db.runOnceOnOpen(() => {
					throw new Error('hi')
				})
			).not.toThrow()
			await expect(db.open()).rejects.toThrow('queued')
			await db.close()
		})
	})

	describe('options', () => {
		test('readOnly', async () => {
			const db = new SQLite({readOnly: true})
			await expectSqliteWorks(db)
			await expect(db.get('CREATE TABLE foo(id)')).rejects.toThrow(
				'SQLITE_READONLY'
			)
			await db.close()
		})

		test('onWillOpen', async () => {
			const fn = jest.fn()
			const db = new SQLite({
				onWillOpen: fn,
			})
			expect(fn).toHaveBeenCalledTimes(0)
			await db.open()
			expect(fn).toHaveBeenCalledTimes(1)
			await db.close()
		})
	})

	describe('.withTransaction()', () => {
		test('works', async () => {
			const db = new SQLite()
			await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
			expect(db.inTransaction).toBe(false)
			db.withTransaction(async () => {
				expect(db.inTransaction).toBe(true)
				await wait(100)
				await db.exec`INSERT INTO foo VALUES (43, 1);`
			})
			expect(db.inTransaction).toBe(false)
			await db.withTransaction(
				() => db.exec`UPDATE foo SET ho = 2 where hi = 43;`
			)
			expect(await db.all`SELECT * from foo`).toEqual([{hi: 43, ho: 2}])
			await db.close()
		})

		test('rollback works', async () => {
			const db = new SQLite()
			await db.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
			expect(db.inTransaction).toBe(false)
			await expect(
				db.withTransaction(async () => {
					expect(db.inTransaction).toBe(true)
					await db.exec`INSERT INTO foo VALUES (43, 1);`
					throw new Error('ignoreme')
				})
			).rejects.toThrow('ignoreme')
			expect(db.inTransaction).toBe(false)
			expect(await db.all`SELECT * from foo`).toEqual([])
			await db.close()
		})

		test('emits', async () => {
			const db = new SQLite()
			const begin = jest.fn()
			const end = jest.fn()
			const rollback = jest.fn()
			const fnl = jest.fn()
			db.on('begin', begin)
			db.on('end', end)
			db.on('rollback', rollback)
			db.on('finally', fnl)
			await db.withTransaction(() => {
				expect(begin).toHaveBeenCalled()
				expect(rollback).not.toHaveBeenCalled()
				expect(end).not.toHaveBeenCalled()
				expect(fnl).not.toHaveBeenCalled()
			})
			expect(begin).toHaveBeenCalledTimes(1)
			expect(rollback).not.toHaveBeenCalled()
			expect(end).toHaveBeenCalledTimes(1)
			expect(fnl).toHaveBeenCalledTimes(1)
			await db
				.withTransaction(() => {
					expect(begin).toHaveBeenCalledTimes(2)
					expect(rollback).not.toHaveBeenCalled()
					expect(end).toHaveBeenCalledTimes(1)
					expect(fnl).toHaveBeenCalledTimes(1)
					// eslint-disable-next-line no-throw-literal
					throw 'foo'
				})
				.catch(e => {
					if (e !== 'foo') throw e
					expect(rollback).toHaveBeenCalledTimes(1)
					expect(end).toHaveBeenCalledTimes(1)
					expect(fnl).toHaveBeenCalledTimes(2)
				})
		})
	})

	test('.dataVersion()', () =>
		tmp.withDir(
			async ({path: dir}) => {
				const file = sysPath.join(dir, 'db')
				const db1 = new SQLite({file})
				const db2 = new SQLite({file})
				const v1 = await db1.dataVersion()
				const v2 = await db2.dataVersion()
				await db1.exec`SELECT 1;`
				expect(await db1.dataVersion()).toBe(v1)
				expect(await db2.dataVersion()).toBe(v2)
				await db1.exec`CREATE TABLE foo(hi INTEGER PRIMARY KEY, ho INT);`
				expect(await db1.dataVersion()).toBe(v1)
				const v2b = await db2.dataVersion()
				expect(v2b).toBeGreaterThan(v2)
				await db2.exec`INSERT INTO foo VALUES (43, 1);`
				expect(await db1.dataVersion()).toBeGreaterThan(v1)
				expect(await db2.dataVersion()).toBe(v2b)
				await db1.close()
				await db2.close()
			},
			{unsafeCleanup: true, prefix: 'sq-data'}
		))

	test('.userVersion()', async () => {
		const db = new SQLite()
		await expect(db.userVersion()).resolves.toBe(0)
		await expect(db.userVersion(5)).resolves.toBe()
		await expect(db.userVersion()).resolves.toBe(5)
	})

	test('.each()', async () => {
		const db = new SQLite()
		await db.exec(
			`CREATE TABLE foo(hi NUMBER); INSERT INTO foo VALUES (42),(43);`
		)
		const arr = []
		await db.each(`SELECT * FROM foo`, ({hi}) => arr.push(hi))
		expect(arr).toEqual([42, 43])
		await db.close()
	})

	describe('error handling', () => {
		test('open: errors with filename', async () => {
			const db = new SQLite({file: '/oienu/ieoienien'})
			await expect(db._openDB()).rejects.toThrow('/oienu/ieoienien')
		})

		test('SQLite methods: errors with filename', async () => {
			const db = new SQLite()
			await expect(db.run('bad sql haha')).rejects.toHaveProperty(
				'code',
				'SQLITE_ERROR'
			)
			await expect(db.run('bad sql haha')).rejects.toThrow(':memory:')
			await expect(db.get('bad sql haha')).rejects.toThrow(':memory:')
			await expect(db.all('bad sql haha')).rejects.toThrow(':memory:')
			await expect(db.exec('bad sql haha')).rejects.toThrow(':memory:')
			await expect(db.each('bad sql haha')).rejects.toThrow(':memory:')
			await expect(db.prepare('bad sql haha').get()).rejects.toThrow(':memory:')
			await db.close()
		})
	})

	describe('vacuum', () => {
		test('works', async () => {
			const db = new SQLite({autoVacuum: true})
			expect(await db.get('PRAGMA auto_vacuum')).toHaveProperty(
				'auto_vacuum',
				2
			)
			expect(db._vacuumToken).toBeDefined()
			await db.close()
			expect(db._vacuumToken).toBeFalsy()
			const db2 = new SQLite()
			await db2.open()
			expect(await db2.get('PRAGMA auto_vacuum')).toHaveProperty(
				'auto_vacuum',
				0
			)
		})

		test('incrementally vacuum', async () =>
			tmp.withDir(
				async ({path: dir}) => {
					const file = sysPath.join(dir, 'db')
					const db = new SQLite({file, autoVacuum: true, vacuumPageCount: 1})
					await db.exec(`
				CREATE TABLE test(field1);

				INSERT INTO test
					WITH RECURSIVE
						cte(x) AS (
							SELECT random()
							UNION ALL
							SELECT random()
								FROM cte
								LIMIT 10000
					)
				SELECT x FROM cte;

				DELETE FROM test;
			`)
					const getLeft = async () => {
						const {freelist_count: left} = await db.get('PRAGMA freelist_count')
						return left
					}
					const left1 = await getLeft()
					expect(await getLeft()).toBeGreaterThan(20)
					await db._vacuumStep()
					expect(await getLeft()).toBeLessThan(left1)
					await db.close()
				},
				{unsafeCleanup: true, prefix: 'iv'}
			))
	})
})
