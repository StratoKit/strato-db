import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {inspect} from 'node:util'
import {EventEmitter} from 'node:events'
import debug from 'debug'
import sqlite3 from 'sqlite3'
import Statement from './Statement'
import {Sema} from 'async-sema'

const dbg = debug('strato-db/sqlite')
const dbgQ = dbg.extend('query')

const RETRY_COUNT = 10

const wait = ms => new Promise(r => setTimeout(r, ms))
const busyWait = () => wait(200 + Math.floor(Math.random() * 1000))

/** The types that SQLite can return as values */
export type SQLiteValue = string | number | null | undefined
/** The types that SQLite can handle as parameter values */
export type SQLiteParam = SQLiteValue | boolean
/** Interpolation values, either an array or an object with named values e.g. `[123, 'bar']` or `{$a: 123, $foo: 'bar'}`*/
export type SQLiteInterpolation =
	| SQLiteParam[]
	| {[name: `:${string}` | `@${string}` | `$${string}`]: SQLiteParam}
	| undefined
/** A result row */
export type SQLiteRow = Record<string, null | undefined | string | number>
export type SQLiteColumnType =
	| 'TEXT'
	| 'NUMERIC'
	| 'INTEGER'
	| 'REAL'
	| 'BLOB'
	| 'JSON'
	| 'JSONB'
export type SQLiteEachCallback<O extends SQLiteRow> = (
	row: O
) => Promise<unknown> | unknown
type SqlTemplateArgs<I extends SQLiteParam[]> = [
	tpl: TemplateStringsArray,
	...vars: I,
]
type SQLiteArgs<I extends SQLiteInterpolation> = I extends
	| undefined
	| []
	| Record<any, never>
	? [string] | [string, I]
	: [string, I]
export type TemplateOrSql<I extends SQLiteInterpolation = SQLiteInterpolation> =
	I extends SQLiteParam[] | []
		? SqlTemplateArgs<I> | SQLiteArgs<I>
		: SQLiteArgs<I>

export type SQLiteModel = {name: string; [x: string]: any}
export type SQLiteModels = {[name in string]: SQLiteModel}
type Statements = {[key: string]: Statement}
export type SQLiteCallback = (db: SQLiteImpl) => unknown | Promise<unknown>
type SQLiteMethods = keyof SqlInstance

/** An instance of sqlite3 */
type SqlInstance = InstanceType<typeof sqlite3.Database>
/** The last rowID changed and the number of changes */
export type SQLiteChangesMeta = {lastID: number; changes: number}

const objToString = o => {
	const s = inspect(o, {compact: true, breakLength: Number.POSITIVE_INFINITY})
	return s.length > 250 ? `${s.slice(0, 250)}… (${s.length}b)` : s
}

const quoteSqlId = s => `"${s.toString().replaceAll('"', '""')}"`

export const valToSql = v => {
	if (typeof v === 'boolean') return v ? '1' : '0'
	if (typeof v === 'number') return v.toString()
	if (v == null) return 'NULL'
	return `'${v.toString().replaceAll("'", "''")}'`
}

const isBusyError = err => err.code === 'SQLITE_BUSY'

/**
 * sql provides templating for SQL.
 *
 * Example:
 * `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
 * ${obj}JSON` ``
 *
 * is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
 * JSON.stringify(obj)])`
 */
export const sql: ((
	tpl: TemplateStringsArray,
	...interpolations: SQLiteParam[]
) => [sql: string, vars: SQLiteParam[]]) & {quoteId: typeof quoteSqlId} = (
	tpl,
	...interpolations
) => {
	let out = tpl[0]
	const vars: SQLiteParam[] = []
	for (let i = 1; i < tpl.length; i++) {
		const val = interpolations[i - 1]
		let str = tpl[i]

		const found = /^(ID|JSON|LIT)\b/.exec(str)
		const mod = found && found[0]
		str = mod ? str.slice(mod.length) : str

		if (mod === 'ID') {
			out += quoteSqlId(val)
		} else if (mod === 'LIT') {
			out += val
		} else {
			out += '?'
			vars.push(mod === 'JSON' ? JSON.stringify(val) : val)
		}
		out += str
	}
	return [out, vars]
}
sql.quoteId = quoteSqlId

const argsToString = (args, isStmt) =>
	args ? (isStmt ? objToString(args) : objToString(args[1])) : ''
const outputToString = (output, method) =>
	method !== 'exec' && method !== 'prepare' ? `-> ${objToString(output)}` : ''

let connId = 1

export type SQLiteConfig = {
	/** path to db file. */
	file?: string
	/** open read-only. */
	readOnly?: boolean
	/** verbose errors. */
	verbose?: boolean
	/** called before opening. */
	onWillOpen?: () => unknown | Promise<unknown>
	/** called after opened. */
	onDidOpen?: SQLiteCallback
	/** name for debugging. */
	name?: string
	/** run incremental vacuum. */
	autoVacuum?: boolean
	/** seconds between incremental vacuums. */
	vacuumInterval?: number
	/** number of pages to clean per vacuum. */
	vacuumPageCount?: number
	/** @deprecated Internal use only. */
	_sqlite?: SqlInstance
	/** @deprecated Internal use only. */
	_store?: SQLiteModels
	/** @deprecated Internal use only. */
	_statements?: Statements
}

/**
 * SQLite is a wrapper around a single SQLite connection (via node-sqlite3).
 * It provides a Promise API, lazy opening, auto-cleaning prepared statements
 * and safe ``db.run`select * from foo where bar=${bar}` `` templating.
 */
// eslint-disable-next-line unicorn/prefer-event-target
class SQLiteImpl extends EventEmitter {
	/** DB file path */
	declare file: string
	/** DB name */
	declare name: string
	/** Are we in withTransaction? */
	inTransaction = false
	declare readOnly?: boolean
	declare store: SQLiteModels
	declare statements: Statements
	declare dbP: Promise<this>

	declare _sqlite?: SqlInstance
	declare _isChild: boolean
	declare _openingDbP?: Promise<this>
	declare _resolveDbP?: (instance: this | Promise<this>) => void
	declare _vacuumToken?: NodeJS.Timer
	declare _optimizerToken?: NodeJS.Timer
	declare _sema: Sema
	declare options: Pick<
		SQLiteConfig,
		| 'onWillOpen'
		| 'onDidOpen'
		| 'verbose'
		| 'autoVacuum'
		| 'vacuumInterval'
		| 'vacuumPageCount'
	>

	constructor(
		{
			file,
			readOnly,
			verbose,
			onWillOpen,
			onDidOpen,
			autoVacuum = false,
			vacuumInterval = 30, // seconds while vacuuming
			vacuumPageCount = 1024 / 4, // 1MB in 4k pages
			name,
			_sqlite,
			_store = {},
			_statements = {},
			...rest
		} = {} as SQLiteConfig
	) {
		super()

		if (Object.keys(rest).length)
			throw new Error(`Unknown options ${Object.keys(rest).join(',')}`)
		this.file = file || ':memory:'
		this.name = `${name || path.basename(this.file, '.db')}|${connId++}`
		// Are we in withTransaction?
		this.inTransaction = false
		this.readOnly = readOnly
		this._isChild = !!_sqlite
		this._sqlite = _sqlite
		this.store = _store
		this.statements = _statements
		this.options = {
			onWillOpen,
			onDidOpen,
			verbose,
			autoVacuum,
			vacuumInterval,
			vacuumPageCount,
		}
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
		this._sema = new Sema(1)
	}

	static sql = sql

	sql = sql

	_queuedOnOpen: {fn: SQLiteCallback; stack?: string}[] = []

	async _openDB() {
		const {file, readOnly, _isChild, options, store} = this
		const {verbose, onWillOpen, onDidOpen, autoVacuum, vacuumInterval} = options

		if (_isChild)
			throw new Error(
				`Child dbs cannot be opened. Perhaps you kept a prepared statement from a child db?`
			)

		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${file}`)

		const _sqlite = (await new Promise((resolve, reject) => {
			if (verbose) sqlite3.verbose()
			const mode = readOnly
				? sqlite3.OPEN_READONLY
				: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
			const db = new sqlite3.Database(file, mode, err => {
				if (err) reject(new Error(`${file}: ${err.message}`))
				else resolve(db)
			})
		})) as SqlInstance

		// Wait for locks
		_sqlite.configure(
			'busyTimeout',
			process.env.NODE_ENV === 'test'
				? 10
				: 1000 + Math.floor(Math.random() * 500)
		)

		const childDb = new SQLiteImpl({
			file,
			readOnly,
			name: this.name,
			_sqlite,
			_store: store,
		})

		// in dev mode, 50% of the time, return unordered selects in reverse order (chosen once per open)
		if (process.env.NODE_ENV === 'development' && Math.random() > 0.5)
			await childDb.exec('PRAGMA reverse_unordered_selects = ON')

		if (!readOnly) {
			// Make sure we have WAL journaling - cannot be done in transaction
			if (file !== ':memory:') {
				const {journal_mode: mode} = (await childDb.get<{journal_mode: string}>(
					'PRAGMA journal_mode'
				))!
				if (mode !== 'wal') {
					const {journal_mode: journalMode} = (await childDb
						.get<{journal_mode: string}>('PRAGMA journal_mode = wal')
						.catch(err => {
							if (!isBusyError(err)) throw err
							// Just assume things are ok
							return {journal_mode: 'wal'}
						}))!
					if (journalMode !== 'wal') {
						// eslint-disable-next-line no-console
						console.error(
							`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
						)
					}
				}
			}

			if (autoVacuum) {
				const {auto_vacuum: mode} = await childDb.get<
					{auto_vacuum: number},
					[],
					true
				>(`PRAGMA auto_vacuum`)
				if (mode !== 2) {
					await childDb
						.exec(`PRAGMA auto_vacuum=INCREMENTAL; VACUUM`)
						.catch(err => {
							if (!isBusyError(err)) throw err
							options.autoVacuum = false
						})
				}
				this._vacuumToken = setInterval(
					() => this._vacuumStep(),
					(vacuumInterval || 500) * 10 * 1000
				)
				this._vacuumToken.unref()
			}
			// Some sane settings
			await childDb.exec(`
					PRAGMA foreign_keys = ON;
					PRAGMA recursive_triggers = ON;
					PRAGMA journal_size_limit = 4000000
				`)
			this._optimizerToken = setInterval(
				() => this.exec(`PRAGMA optimize`),
				2 * 3600 * 1000
			)
			this._optimizerToken.unref()

			if (onDidOpen) await onDidOpen(childDb)
			for (const {fn, stack} of this._queuedOnOpen) {
				try {
					await fn(childDb)
				} catch (error) {
					if (error instanceof Error)
						error.message = `in function queued ${stack?.replace(
							/^(?:[^\n]*\n){2}\s*/m,
							''
						)}: ${error.message}`
					throw error
				}
			}
			this._queuedOnOpen.length = 0
			await childDb.close()
		}

		this._sqlite = _sqlite

		dbg(`${this.name} opened  ${file}`)

		return this
	}

	/**
	 * `true` if an sqlite connection was set up. Mostly useful for tests.
	 */
	get isOpen() {
		return Boolean(this._sqlite)
	}

	/**
	 * Force opening the database instead of doing it lazily on first access.
	 *
	 * @returns A promise for the DB being ready to use.
	 */
	open(): Promise<this> {
		const {_resolveDbP} = this
		if (_resolveDbP) {
			this._openingDbP = this._openDB().finally(() => {
				this._openingDbP = undefined
			})
			_resolveDbP(this._openingDbP)
			this._resolveDbP = undefined
			this.dbP.catch(() => this.close())
		}
		return this.dbP
	}

	/**
	 * Runs the passed function once, either immediately if the connection is
	 * already open, or when the database will be opened next.
	 * Note that if the function runs immediately, its return value is returned.
	 * If this is a Promise, it is the caller's responsibility to handle errors.
	 * Otherwise, the function will be run once after onDidOpen, and errors will
	 * cause the open to fail.
	 *
	 * @param {(db: SQLite)=>void} fn
	 * @returns {*} Either the function return value or undefined.
	 */
	runOnceOnOpen(fn: SQLiteCallback): any {
		if (this.isOpen) {
			// note that async errors are not handled
			return fn(this)
		}
		// eslint-disable-next-line unicorn/error-message
		this._queuedOnOpen.push({fn, stack: new Error('').stack})
	}

	/**
	 * Close the database connection, including the prepared statements.
	 *
	 * @returns A promise for the DB being closed.
	 */
	async close(): Promise<void> {
		if (this._openingDbP) {
			dbg(`${this.name} waiting for open to complete before closing`)
			await this._openingDbP.catch(() => {})
		}
		if (!this._sqlite) return
		const {_sqlite, _isChild} = this
		this._sqlite = undefined
		clearInterval(this._optimizerToken)
		this._optimizerToken = undefined
		clearInterval(this._vacuumToken)
		this._vacuumToken = undefined

		if (!_isChild) dbg(`${this.name} closing`)

		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})

		const stmts = Object.values(this.statements)
		if (stmts.length)
			await Promise.all(stmts.map(stmt => stmt.finalize().catch(() => {})))

		// We only want to close our own statements, not the db
		if (_isChild) {
			dbg(`${this.name} child db closed`)
			return
		}

		if (_sqlite) await this._call('close', [], _sqlite, this.name)
		dbg(`${this.name} closed`)
	}

	async _hold(method) {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		await this.open()
		return this._sqlite!
	}

	async _call<O = unknown>(
		method: SQLiteMethods,
		// some methods don't take args
		// also, some methods take callbacks but we fudge those
		args: TemplateOrSql | [],
		obj: SqlInstance | undefined,
		name: string,
		returnThis?: boolean,
		returnFn?: boolean
	): Promise<O>
	async _call<O = unknown>(
		method: SQLiteMethods,
		args: unknown[],
		obj: Statement | undefined,
		name: string,
		returnThis?: boolean,
		returnFn?: boolean
	): Promise<O>
	async _call<O = unknown>(
		method: SQLiteMethods,
		args: TemplateOrSql | [] | [SQLiteInterpolation],
		obj: SqlInstance | Statement | undefined,
		name: string,
		returnThis?: boolean,
		returnFn?: boolean
	): Promise<O> {
		const isStmt = obj && obj instanceof Statement
		let _sqlite: SqlInstance | sqlite3.Statement
		if (!obj) _sqlite = await this._hold(method)
		else if (isStmt) _sqlite = obj._stmt!
		else _sqlite = obj
		if (!_sqlite)
			throw new Error(`${name}: sqlite or statement not initialized`)

		// Template strings
		if (!isStmt && Array.isArray(args![0])) {
			args = sql(...(args as [TemplateStringsArray]))
			// Can't pass empty array when no params
			if (args[1].length === 0) args.pop()
		}

		const shouldDebug = dbgQ.enabled || this.listenerCount('call')
		let now, duration
		const result = new Promise<O>((resolve, reject) => {
			// eslint-disable-next-line prefer-const
			let cb, fnResult
			const runQuery = shouldDebug
				? () => {
						fnResult = this._sema
							.acquire()
							.then(() => {
								now = performance.now()
								return _sqlite[method](...args, cb)
							})
							.catch(cb)
				  }
				: () => {
						fnResult = _sqlite[method](...args, cb)
				  }
			let busyRetry = RETRY_COUNT
			// We need to consume `this` from sqlite3 callback
			// eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias -- we need it
			const self = this
			cb = function (this: any, err: Error | undefined, out?: unknown) {
				if (shouldDebug) {
					duration = performance.now() - now
					self._sema.release()
				}
				if (err) {
					if (isBusyError(err) && busyRetry--) {
						dbgQ(`${name} busy, retrying`)
						busyWait().then(runQuery).catch(reject)
						return
					}
					const error = new Error(`${name}: sqlite3: ${err.message}`)
					;(error as any).code = (err as any).code
					reject(error)
				} else
					resolve(
						returnFn
							? fnResult
							: returnThis
							? {lastID: this.lastID, changes: this.changes}
							: out
					)
			}
			if (!_sqlite[method])
				return cb({message: `method ${method} not supported`})
			runQuery()
		})
		if (shouldDebug) {
			const query = isStmt
				? obj._name
				: String(args![0]).replaceAll(/\s+/g, ' ')
			const notify = (error: Error | undefined, output?: O): O => {
				if (dbgQ.enabled)
					dbgQ(
						'%s',
						`${name}.${method} ${
							error ? `SQLite error: ${error.message} ` : ''
						}${query} ${argsToString(args, isStmt)} ${duration.toLocaleString(
							undefined,
							{maximumFractionDigits: 2}
						)}ms${output ? ` ${outputToString(output, method)}` : ''}`
					)
				if (this.listenerCount('call'))
					this.emit('call', {
						name,
						method,
						isStmt,
						query,
						args: isStmt ? args : args![1],
						duration,
						output,
						error,
					})
				if (error) throw error
				return output!
			}
			return result.then(output => notify(undefined, output), notify)
		}
		return result
	}

	/**
	 * Return all rows for the given query.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns {Promise<Object[]>} - the results.
	 */
	all<
		O extends SQLiteRow = SQLiteRow,
		I extends SQLiteInterpolation = SQLiteInterpolation,
	>(...args: TemplateOrSql<I>): Promise<O[]> {
		return this._call('all', args, this._sqlite, this.name)
	}

	/**
	 * Return the first row for the given query.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns {Promise<Object | null>} - the result or falsy if missing.
	 */
	get<
		O extends SQLiteRow = SQLiteRow,
		I extends SQLiteInterpolation = SQLiteInterpolation,
		AlwaysResult extends boolean = boolean,
	>(
		...args: TemplateOrSql<I>
	): Promise<AlwaysResult extends true ? O : O | undefined> {
		return this._call('get', args, this._sqlite, this.name)
	}

	/**
	 * Run the given query and return the metadata.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns an object with `lastID` and `changes`
	 */
	run<I extends SQLiteInterpolation = SQLiteInterpolation>(
		...args: TemplateOrSql<I>
	): Promise<{lastID: number; changes: number}> {
		return this._call('run', args, this._sqlite, this.name, true)
	}

	/**
	 * Run the given query and return nothing. Slightly more efficient than
	 * {@link run}
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns - a promise for execution completion.
	 */
	async exec<I extends SQLiteInterpolation = SQLiteInterpolation>(
		...args: TemplateOrSql<I>
	): Promise<void> {
		await this._call('exec', args, this._sqlite, this.name)
	}

	/**
	 * Register an SQL statement for repeated running. This will store the SQL and
	 * will prepare the statement with SQLite whenever needed, as well as finalize
	 * it when closing the connection.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [name]  - a short name to use in debug logs.
	 * @returns {Statement} - the statement.
	 */
	// eslint-disable-next-line no-shadow
	prepare(sql: string, name: string): Statement {
		if (this.statements[sql]) return this.statements[sql]
		return new Statement(this, sql, name)
	}

	/**
	 * Run the given query and call the function on each item.
	 * Note that node-sqlite3 seems to just fetch all data in one go.
	 *
	 * @param sql     - the SQL statement to be executed.
	 * @param [vars]  - the variables to be bound to the statement.
	 * @param cb      - the function to call on each row.
	 * @returns - a promise for execution completion.
	 */
	each<
		O extends SQLiteRow = SQLiteRow,
		I extends SQLiteInterpolation = SQLiteInterpolation,
	>(
		...args: [...TemplateOrSql<I>, onRow: SQLiteEachCallback<O>]
	): Promise<void> {
		const lastIdx = args.length - 1
		if (typeof args[lastIdx] === 'function') {
			// err is always null, no reason to have it
			const onRow = args[lastIdx] as SQLiteEachCallback<O>
			args[lastIdx] = ((_, row) => onRow(row)) as any
		}
		return this._call('each', args as any, this._sqlite, this.name)
	}

	declare _dataVSql?: Statement<{data_version: number}, [], true>
	/**
	 * Returns the data_version, which increases when other connections write to
	 * the database.
	 *
	 * @returns {Promise<number>} - the data version.
	 */
	async dataVersion(): Promise<number> {
		if (!this._sqlite) await this._hold('dataVersion')
		if (!this._dataVSql)
			this._dataVSql = this.prepare('PRAGMA data_version', 'dataV') as any
		const {data_version: v} = await this._dataVSql!.get()
		return v
	}

	declare _userVSql?: Statement<{user_version: number}, [], true>
	/**
	 * Returns or sets the user_version, an arbitrary integer connected to the
	 * database.
	 *
	 * @param [newV]  - if given, sets the user version.
	 * @returns The user version.
	 */
	async userVersion(newV?: number): Promise<number> {
		if (!this._sqlite) await this._hold('userVersion')
		// Can't prepare or use pragma with parameter
		if (newV)
			await this._call(
				'exec',
				[`PRAGMA user_version=${Number(newV)}`],
				this._sqlite,
				this.name
			)
		if (!this._userVSql)
			this._userVSql = this.prepare('PRAGMA user_version', 'userV') as any
		const {user_version: v} = await this._userVSql!.get()
		return v
	}

	transactionP = Promise.resolve() as Promise<any>

	/**
	 * Run a function in an immediate transaction. Within a connection, the
	 * invocations are serialized, and between connections it uses busy retry
	 * waiting. During a transaction, the database can still be read.
	 *
	 * @param fn  - the function to call. It doesn't get any parameters.
	 * @returns - a promise for transaction completion.
	 * @throws - when the transaction fails or after too many retries.
	 */
	async withTransaction<R>(fn: () => R): Promise<Awaited<R>> {
		if (this.readOnly) throw new Error(`${this.name}: DB is readonly`)
		if (!this._sqlite) await this._hold('transaction')

		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	async __withTransaction<R>(
		fn: () => R,
		busyRetry = RETRY_COUNT
	): Promise<Awaited<R>> {
		try {
			this.inTransaction = true
			await this.exec(`BEGIN IMMEDIATE`)
			this.emit('begin')
		} catch (error) {
			if (isBusyError(error) && busyRetry) {
				// Transaction already running
				if (busyRetry === RETRY_COUNT) dbg(`${this.name} DB is busy, retrying`)
				await busyWait()
				return this.__withTransaction(fn, busyRetry - 1)
			}
			this.inTransaction = false
			throw error
		}
		let result
		try {
			result = await fn()
		} catch (error) {
			if (process.env.NODE_ENV !== 'test')
				// eslint-disable-next-line no-console
				console.error(
					`${this.name} !!! transaction failure, rolling back`,
					error
				)
			await this.exec(`ROLLBACK`)
			this.inTransaction = false
			this.emit('rollback')
			this.emit('finally')
			throw error
		}
		await this.exec(`END`)
		this.inTransaction = false
		this.emit('end')
		this.emit('finally')
		return result
	}

	declare _freeCountSql?: Statement<{freelist_count: number}, [], true>
	async _vacuumStep() {
		if (!this._sqlite) return
		const {vacuumInterval = 500, vacuumPageCount = 5} = this.options
		if (!this._freeCountSql)
			this._freeCountSql = this.prepare(
				'PRAGMA freelist_count',
				'freeCount'
			) as any
		const {freelist_count: left} = await this._freeCountSql!.get()
		// leave some free pages in there
		if (left < vacuumPageCount * 20 || !this._sqlite) return
		await this.exec(`PRAGMA incremental_vacuum(${vacuumPageCount})`)
		const t = setTimeout(() => this._vacuumStep(), vacuumInterval * 1000)
		t.unref()
	}
}

export default SQLiteImpl
