import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {inspect} from 'node:util'
import {EventEmitter} from 'node:events'
import debug from 'debug'
import sqlite3 from 'sqlite3'
import Statement from './Statement'

const dbg = debug('strato-db/sqlite')
const dbgQ = dbg.extend('query')

const RETRY_COUNT = 10

const wait = ms => new Promise(r => setTimeout(r, ms))
const busyWait = () => wait(200 + Math.floor(Math.random() * 1000))

/** The types that SQLite can return as values */
export type SQLiteValue = string | number | null | undefined
/** The types that SQLite can handle as parameter values */
export type SQLiteParam = SQLiteValue | boolean
/** Interpolation values, either an array or an object with named values */
export type SQLiteInterpolation =
	| SQLiteParam[]
	| {[name: string]: SQLiteParam}
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
export type SQLiteEachCallback<O extends SQLiteRow> = (
	row: O
) => Promise<unknown> | unknown
type SqlTemplateArgs<_O extends SQLiteRow, I extends SQLiteParam[]> = [
	tpl: TemplateStringsArray,
	...vars: I
]
type SQLiteArgs<
	_O extends SQLiteRow,
	I extends SQLiteInterpolation
> = I extends SQLiteParam[] ? [string] | [string, I] : [string, I]
type TemplateOrSql<
	O extends SQLiteRow,
	I extends SQLiteInterpolation
> = I extends SQLiteParam[]
	? SqlTemplateArgs<O, I> | SQLiteArgs<O, I>
	: SQLiteArgs<O, I>

export type SQLiteModel<Name extends string> = {name: Name; [x: string]: any}
export type SQLiteModels = {[name in string]: SQLiteModel<name>}
type Statements = {[key: string]: Statement}
export type SQLiteCallback = (db: SQLite) => unknown | Promise<unknown>

/** An instance of sqlite3 */
type SqlInstance = InstanceType<typeof sqlite3.Database>
/** The last rowID changed and the number of changes */
export type SQLiteChangesMeta = {lastID: number; changes: number}

const objToString = o => {
	const s = inspect(o, {compact: true, breakLength: Number.POSITIVE_INFINITY})
	return s.length > 250 ? `${s.slice(0, 250)}… (${s.length}b)` : s
}

const quoteSqlId = s => `"${s.toString().replace(/"/g, '""')}"`

export const valToSql = v => {
	if (typeof v === 'boolean') return v ? '1' : '0'
	if (typeof v === 'number') return v.toString()
	if (v == null) return 'NULL'
	return `'${v.toString().replace(/'/g, "''")}'`
}

class SQLiteError extends Error {
	code: string
	constructor(name: string, code: string, message: string) {
		super(`sqlite3: ${name}: ${message}`)
		this.code = code
	}
}

const isBusyError = (err: SQLiteError | Error) =>
	'code' in err && err.code === 'SQLITE_BUSY'

/**
 * Template Tag for SQL statements. Generic type O is the output type,
 * I is the type of any extra defined interpolations.
 *
 * @example
 *
 * `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
 * ${obj}JSON` ``
 *
 * is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
 * JSON.stringify(obj)])`
 *
 */
export const sql = <
	O extends SQLiteRow = SQLiteRow,
	// If you don't specify I, we don't enforce it
	I extends SQLiteParam[] = any
>(
	tpl: TemplateStringsArray,
	...interpolations: I
): SQLiteArgs<O, I> => {
	let out = tpl[0]
	const vars = [] as SQLiteParam[]
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
			vars.push(mod === 'JSON' ? JSON.stringify(val) : (val as SQLiteParam))
		}
		out += str
	}
	return (vars.length ? [out, vars] : [out]) as SQLiteArgs<O, I>
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
 * emits these events, all without parameters:
 * * 'begin': transaction begins
 * * 'rollback': transaction finished with failure
 * * 'end': transaction finished successfully
 * * 'finally': transaction finished
 * * 'call': call to SQLite completed, includes data and duration
 */
class SQLite extends EventEmitter {
	/** DB file path */
	declare file: string
	/** DB name */
	declare name: string
	/** Are we in withTransaction? */
	inTransaction = false
	declare readOnly: boolean
	declare store: SQLiteModels
	declare statements: Statements
	declare config: Pick<
		SQLiteConfig,
		'onWillOpen' | 'onDidOpen' | 'verbose' | 'autoVacuum'
	> &
		Required<Pick<SQLiteConfig, 'vacuumInterval' | 'vacuumPageCount'>>
	declare dbP: Promise<this>

	declare _sqlite?: SqlInstance
	declare _isChild: boolean
	declare _openingDbP?: Promise<this>
	declare _resolveDbP?: (instance: this | Promise<this>) => void
	declare _vacuumToken?: NodeJS.Timer
	declare _optimizerToken?: NodeJS.Timer

	constructor({
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
	}: SQLiteConfig = {}) {
		super()

		if (Object.keys(rest).length)
			throw new Error(`Unknown config ${Object.keys(rest).join(',')}`)
		this.file = file || ':memory:'
		this.name = `${name || path.basename(this.file, '.db')}|${connId++}`
		this.readOnly = !!readOnly
		this._isChild = !!_sqlite
		this._sqlite = _sqlite
		this.store = _store
		this.statements = _statements
		this.config = {
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
	}

	/**
	 * Template Tag for SQL statements.
	 *
	 * @example
	 *
	 * `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
	 * ${obj}JSON` ``
	 *
	 * is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
	 * JSON.stringify(obj)])`
	 *
	 */
	static sql = sql

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - this is weird
	sql = sql

	_queuedOnOpen: {
		fn: SQLiteCallback
		stack?: string
	}[] = []

	async _openDB() {
		const {file, readOnly, _isChild, config, store} = this
		const {verbose, onWillOpen, onDidOpen, autoVacuum, vacuumInterval} = config

		if (_isChild)
			throw new Error(
				`Child dbs cannot be opened. Perhaps you kept a prepared statement from a child db?`
			)

		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${file}`)

		const _sqlite = await new Promise<SqlInstance>((resolve, reject) => {
			if (verbose) sqlite3.verbose()
			const mode = readOnly
				? sqlite3.OPEN_READONLY
				: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
			const db = new sqlite3.Database(file, mode, err => {
				if (err) reject(new Error(`${file}: ${err.message}`))
				else resolve(db)
			})
		})

		// Wait for locks
		_sqlite.configure(
			'busyTimeout',
			process.env.NODE_ENV === 'test'
				? 10
				: 1000 + Math.floor(Math.random() * 500)
		)

		const childDb = new SQLite({
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
				const {journal_mode: mode} = (await childDb.get(
					'PRAGMA journal_mode'
				)) as {journal_mode: string}
				if (mode !== 'wal') {
					const {journal_mode: journalMode} = (await childDb
						.get('PRAGMA journal_mode = wal')
						.catch(err => {
							if (!isBusyError(err)) throw err
						})) as {journal_mode: string}
					if (journalMode !== 'wal') {
						// eslint-disable-next-line no-console
						console.error(
							`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
						)
					}
				}
			}

			if (autoVacuum) {
				const {auto_vacuum: mode} = (await childDb.get(
					`PRAGMA auto_vacuum`
				)) as {auto_vacuum: number}
				if (mode !== 2) {
					await childDb
						.exec(`PRAGMA auto_vacuum=INCREMENTAL; VACUUM`)
						.catch(err => {
							if (!isBusyError(err)) throw err
							config.autoVacuum = false
						})
				}
				this._vacuumToken = setInterval(
					() => this._vacuumStep(),
					vacuumInterval * 10 * 1000
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
					if (error?.message)
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
	 * @param fn
	 * @returns Either the function return value or undefined.
	 */
	runOnceOnOpen(fn: SQLiteCallback) {
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
			await this._openingDbP.catch(() => {
				// ignore opening errors
			})
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
			// eslint-disable-next-line @typescript-eslint/no-empty-function
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
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		return this._sqlite!
	}

	async _call<T>(
		method,
		args: any[],
		obj: SqlInstance | Statement | undefined,
		name: string,
		returnThis?: boolean,
		returnFn?: boolean
	): Promise<T> {
		const isStmt = Statement.isStatement(obj)
		let _sqlite: SqlInstance | InstanceType<typeof Statement>['_stmt']
		if (!obj) _sqlite = await this._hold(method)
		else if (isStmt) _sqlite = obj._stmt
		else _sqlite = obj
		if (!_sqlite)
			throw new Error(`${name}: sqlite or statement not initialized`)
		const mySqlite = _sqlite

		// Template strings
		if (!isStmt && Array.isArray(args[0]) && 'raw' in args[0]) {
			args = sql(...(args as [TemplateStringsArray, ...SQLiteParam[]]))
		}
		const shouldDebug = dbgQ.enabled || this.listenerCount('call')
		const now = shouldDebug ? performance.now() : undefined
		let fnResult
		const result = new Promise((resolve, reject) => {
			// eslint-disable-next-line prefer-const
			let cb
			const runQuery = () => {
				fnResult = mySqlite[method](...args, cb)
			}
			let busyRetry = RETRY_COUNT
			// We need to consume `this` from sqlite3 callback
			cb = function (err, out) {
				if (err) {
					if (isBusyError(err) && busyRetry--) {
						return busyWait().then(runQuery)
					}
					const error = new SQLiteError(name, err.code, err.message)
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
			if (!mySqlite[method])
				return cb({message: `method ${method} not supported`})
			fnResult = mySqlite[method](...(args || []), cb)
		})
		if (now) {
			const query = isStmt ? obj._name : String(args[0]).replace(/\s+/g, ' ')
			const notify = (error?: Error, output?: unknown) => {
				const duration = performance.now() - now
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
						args: isStmt ? args : args[1],
						duration,
						output,
						error,
					})
			}
			// eslint-disable-next-line promise/catch-or-return
			result.then(
				output => {
					if (returnFn) output = fnResult
					notify(undefined, output)
				},
				error => {
					notify(error)
				}
			)
		}
		return result as T
	}

	/**
	 * Get all rows for the given query.
	 */
	all<O extends SQLiteRow = SQLiteRow, I extends SQLiteInterpolation = any>(
		...args: TemplateOrSql<O, I>
	) {
		return this._call<O[]>('all', args, this._sqlite, this.name)
	}

	/**
	 * Get the first row for the given query.
	 *
	 * @returns The row or undefined if missing.
	 */
	get<O extends SQLiteRow = SQLiteRow, I extends SQLiteInterpolation = any>(
		...args: TemplateOrSql<O, I>
	) {
		return this._call<O | undefined>('get', args, this._sqlite, this.name)
	}

	/**
	 * Run the given query and return the metadata.
	 */
	run<O extends SQLiteRow = SQLiteRow, I extends SQLiteInterpolation = any>(
		...args: TemplateOrSql<O, I>
	) {
		return this._call<SQLiteChangesMeta>(
			'run',
			args,
			this._sqlite,
			this.name,
			true
		)
	}

	/**
	 * Run the given query and return nothing. Slightly more efficient than .run()
	 */
	async exec<
		O extends SQLiteRow = SQLiteRow,
		I extends SQLiteInterpolation = any
	>(...args: TemplateOrSql<O, I>) {
		await this._call<void>('exec', args, this._sqlite, this.name)
	}

	/**
	 * Register an SQL statement for repeated running. This will store the SQL and
	 * will prepare the statement with SQLite whenever needed, as well as finalize
	 * it when closing the connection.
	 *
	 * @returns The statement.
	 */
	prepare<O extends SQLiteRow = SQLiteRow, I extends SQLiteInterpolation = any>(
		sqlText: string,
		name?: string
	) {
		if (this.statements[sqlText])
			return this.statements[sqlText] as unknown as Statement<O, I>
		return new Statement<O, I>(this, sqlText, name)
	}

	/**
	 * Run the given query and call the function on each item.
	 * Note that node-sqlite3 seems to just fetch all data in one go.
	 *
	 * @returns The number of rows processed.
	 */
	each<O extends SQLiteRow = SQLiteRow, I extends SQLiteInterpolation = any>(
		...args:
			| [string, SQLiteEachCallback<O>]
			| [string, I, SQLiteEachCallback<O>]
	): Promise<number> {
		const lastIdx = args.length - 1
		const onRow = args[lastIdx]
		if (typeof onRow === 'function') {
			// err is always null, no reason to have it
			args[lastIdx] = ((_, row) =>
				onRow(row) as unknown) as SQLiteEachCallback<O>
		}
		return this._call<number>('each', args, this._sqlite, this.name)
	}

	_dataVSql: Statement<{data_version: number}, undefined>
	/**
	 * Get the data_version, which increases when other connections write to
	 * the database.
	 */
	async dataVersion() {
		if (!this._sqlite) await this._hold('dataVersion')
		if (!this._dataVSql)
			this._dataVSql = this.prepare('PRAGMA data_version', 'dataV')
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const {data_version: v} = (await this._dataVSql.get())!
		return v
	}

	_userVSql: Statement<{user_version: number}, undefined>

	/**
	 * Get or set the user_version, an arbitrary integer connected to the database.
	 *
	 * @param [newV]  - if given, sets the user version.
	 * @returns The user version.
	 */
	async userVersion(newV?: number) {
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
			this._userVSql = this.prepare('PRAGMA user_version', 'userV')
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const {user_version: v} = (await this._userVSql.get())!
		return v
	}

	transactionP = Promise.resolve() as Promise<any>

	/**
	 * Run a function in an immediate transaction. Within a connection, the
	 * invocations are serialized, and between connections it uses busy retry
	 * waiting. During a transaction, the database can still be read.
	 *
	 * @param fn  - the function to call. It doesn't get any parameters.
	 * @returns A promise For transaction completion.
	 * @throws When the transaction fails or after too many retries.
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

	_freeCountSql: Statement<{freelist_count: number}, undefined>
	async _vacuumStep() {
		if (!this._sqlite) return
		const {vacuumInterval, vacuumPageCount} = this.config
		if (!this._freeCountSql)
			this._freeCountSql = this.prepare('PRAGMA freelist_count', 'freeCount')
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const {freelist_count: left} = (await this._freeCountSql.get())!
		// leave some free pages in there
		if (left < vacuumPageCount * 20 || !this._sqlite) return
		await this.exec(`PRAGMA incremental_vacuum(${vacuumPageCount})`)
		const t = setTimeout(() => this._vacuumStep(), vacuumInterval * 1000)
		t.unref()
	}
}

export default SQLite
