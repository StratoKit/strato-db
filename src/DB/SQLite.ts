import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {inspect} from 'node:util'
import {EventEmitter} from 'node:events'
import debug from 'debug'
import sqlite3 from 'sqlite3'
import StatementImpl from './Statement'
import {Sema} from 'async-sema'
import type {
	SQLiteOptions,
	SQLiteParam,
	SqlTag,
	SQLiteMeta,
	SQLiteRow,
	DBEachCallback,
	DB,
	SQLite,
	Statement,
} from '../../types'

const dbg = debug('strato-db/sqlite')
const dbgQ = dbg.extend('query')

const RETRY_COUNT = 10

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const busyWait = () => wait(200 + Math.floor(Math.random() * 1000))

const objToString = (o: any) => {
	const s = inspect(o, {compact: true, breakLength: Number.POSITIVE_INFINITY})
	return s.length > 250 ? `${s.slice(0, 250)}… (${s.length}b)` : s
}

const quoteSqlId = (s: any): string => `"${s.toString().replaceAll('"', '""')}"`

export const valToSql = (v: SQLiteParam): string => {
	if (typeof v === 'boolean') return v ? '1' : '0'
	if (typeof v === 'number') return v.toString()
	if (v == null) return 'NULL'
	return `'${v.toString().replaceAll("'", "''")}'`
}

interface ExtendedError extends Error {
	code?: string
}

const isBusyError = (err: ExtendedError): boolean => err.code === 'SQLITE_BUSY'

/**
 * Sql provides templating for SQL.
 *
 * Example: `db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json =
 * ${obj}JSON``
 *
 * Is converted to `db.all('select * from "foo" where t = ? and json = ?', [bar,
 * JSON.stringify(obj)])`
 */
export const sql: SqlTag = (tpl, ...interpolations) => {
	let out = tpl[0]
	const vars: string[] = []
	for (let i = 1; i < tpl.length; i++) {
		const val = interpolations[i - 1]
		let str = tpl[i]

		const found = /^(ID|JSON|LIT)\b/.exec(str)
		const mod = found && found[0]
		str = mod ? str.slice(mod.length) : str

		if (mod === 'ID') {
			out += quoteSqlId(val)
		} else if (mod === 'LIT') {
			out += val as string
		} else {
			out += '?'
			vars.push(mod === 'JSON' ? JSON.stringify(val) : String(val))
		}
		out += str
	}
	return [out, vars]
}

// Add the quoteId method to the sql function
Object.defineProperty(sql, 'quoteId', {
	value: quoteSqlId,
	writable: false,
	enumerable: true,
})

interface CallData {
	name: string
	method: string
	isStmt: boolean
	query: string
	args: any
	duration: number
	output?: any
	error?: ExtendedError
}

const argsToString = (args: any, isStmt: boolean) =>
	args ? (isStmt ? objToString(args) : objToString(args[1])) : ''

const outputToString = (output: any, method: string) =>
	method !== 'exec' && method !== 'prepare' ? `-> ${objToString(output)}` : ''

let connId = 1

type QueuedFunction = {
	fn: (db: SQLite) => Promise<unknown> | unknown
	stack: string
}

type StatementCache = Map<string, Statement>

// eslint-disable-next-line unicorn/prefer-event-target
class SQLiteImpl extends EventEmitter implements SQLite {
	file: string
	name: string
	inTransaction: boolean
	readOnly: boolean
	_isChild: boolean
	_sqlite: any
	store: Record<string, any>
	_statements: StatementCache
	options: Required<
		Pick<
			SQLiteOptions,
			| 'onWillOpen'
			| 'onDidOpen'
			| 'verbose'
			| 'autoVacuum'
			| 'vacuumInterval'
			| 'vacuumPageCount'
		>
	>
	dbP: Promise<SQLiteImpl>
	_resolveDbP!: (value: SQLiteImpl | PromiseLike<SQLiteImpl>) => void
	_openingDbP: Promise<SQLiteImpl> | null = null
	_sema: Sema
	_dataVSql?: Statement
	_userVSql?: Statement
	_freeCountSql?: Statement
	_optimizerToken?: NodeJS.Timeout
	_vacuumToken?: NodeJS.Timeout

	constructor(
		options: SQLiteOptions & {
			_sqlite?: any
			_store?: Record<string, any>
			_statements?: StatementCache
		} = {}
	) {
		const {
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
			_statements = new Map(),
			...rest
		} = options
		super()

		if (Object.keys(rest).length)
			throw new Error(`Unknown options ${Object.keys(rest).join(',')}`)
		this.file = file || ':memory:'
		this.name = `${name || path.basename(this.file, '.db')}|${connId++}`
		// Are we in withTransaction?
		this.inTransaction = false
		this.readOnly = Boolean(readOnly)
		this._isChild = Boolean(_sqlite)
		this._sqlite = _sqlite
		this.store = _store
		this._statements = _statements
		this.options = {
			onWillOpen: onWillOpen || (() => {}),
			onDidOpen: onDidOpen || (() => {}),
			verbose: Boolean(verbose),
			autoVacuum,
			vacuumInterval,
			vacuumPageCount,
		}
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
		this._sema = new Sema(1)
	}

	_queuedOnOpen: QueuedFunction[] = []

	async _openDB(): Promise<SQLiteImpl> {
		const {file, readOnly, _isChild, options, store} = this
		const {verbose, onWillOpen, onDidOpen, autoVacuum, vacuumInterval} = options

		if (_isChild)
			throw new Error(
				`Child dbs cannot be opened. Perhaps you kept a prepared statement from a child db?`
			)

		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${file}`)

		const _sqlite = await new Promise<any>((resolve, reject) => {
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
				const result = await childDb.get('PRAGMA journal_mode')
				if (result && result.journal_mode !== 'wal') {
					const walResult = await childDb
						.get('PRAGMA journal_mode = wal')
						.catch(err => {
							if (!isBusyError(err)) throw err
							return undefined
						})
					const journalMode = walResult && walResult.journal_mode
					if (journalMode !== 'wal') {
						// eslint-disable-next-line no-console
						console.error(
							`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
						)
					}
				}
			}

			if (autoVacuum) {
				const result = await childDb.get(`PRAGMA auto_vacuum`)
				const mode = result && result.auto_vacuum
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

			if (onDidOpen) await onDidOpen(childDb as unknown as DB)
			for (const {fn, stack} of this._queuedOnOpen) {
				try {
					await fn(childDb as unknown as SQLite)
				} catch (error: any) {
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

	/** `true` if an sqlite connection was set up. Mostly useful for tests. */
	get isOpen(): boolean {
		return Boolean(this._sqlite)
	}

	/** Force opening the database instead of doing it lazily on first access. */
	open(): Promise<void> {
		const {_resolveDbP} = this
		if (_resolveDbP) {
			this._openingDbP = this._openDB().finally(() => {
				this._openingDbP = null
			})
			_resolveDbP(this._openingDbP)
			this._resolveDbP = null as any
			this.dbP.catch(() => this.close())
		}
		return this.dbP.then(() => {})
	}

	/**
	 * Runs the passed function once, either immediately if the connection is
	 * already open, or when the database will be opened next. Note that if the
	 * function runs immediately, its return value is returned. If this is a
	 * Promise, it is the caller's responsibility to handle errors. Otherwise, the
	 * function will be run once after onDidOpen, and errors will cause the open
	 * to fail.
	 */
	runOnceOnOpen(fn: (db: SQLite) => void): void {
		if (this.isOpen) {
			// note that async errors are not handled
			fn(this as unknown as SQLite)
			return
		}
		// eslint-disable-next-line unicorn/error-message
		this._queuedOnOpen.push({fn, stack: new Error('').stack || ''})
	}

	/** Close the database connection, including the prepared statements. */
	async close(): Promise<void> {
		if (this._openingDbP) {
			dbg(`${this.name} waiting for open to complete before closing`)
			await this._openingDbP.catch(() => {})
		}
		if (!this._sqlite) return
		const {_sqlite, _isChild} = this
		this._sqlite = null
		if (this._optimizerToken) {
			clearInterval(this._optimizerToken)
			this._optimizerToken = undefined
		}
		if (this._vacuumToken) {
			clearInterval(this._vacuumToken)
			this._vacuumToken = undefined
		}

		if (!_isChild) dbg(`${this.name} closing`)

		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})

		for (const stmt of this._statements.values()) {
			await stmt.finalize().catch(() => {})
		}

		// We only want to close our own statements, not the db
		if (_isChild) {
			dbg(`${this.name} child db closed`)
			return
		}

		if (_sqlite) await this._call('close', [], _sqlite, this.name)
		dbg(`${this.name} closed`)
	}

	async _hold(method: string): Promise<any> {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		await this.open()
		return this._sqlite
	}

	async _call(
		method: string,
		args: any[],
		obj: any,
		name: string,
		returnThis?: boolean,
		returnFn?: boolean
	): Promise<any> {
		const isStmt = obj && obj.isStatement
		let _sqlite
		if (!obj) _sqlite = await this._hold(method)
		else if (isStmt) _sqlite = obj._stmt
		else _sqlite = obj
		if (!_sqlite)
			throw new Error(`${name}: sqlite or statement not initialized`)

		// Template strings
		if (!isStmt && Array.isArray(args[0])) {
			// @ts-ignore - Handle template string calls
			args = sql(...args)
			if (!args[1].length) args.pop()
		}

		const shouldDebug = dbgQ.enabled || this.listenerCount('call')
		let now, duration
		const result = new Promise((resolve, reject) => {
			let fnResult
			const runQuery = shouldDebug
				? () => {
						fnResult = this._sema
							.acquire()
							.then(() => {
								now = performance.now()
								return _sqlite[method](...(args || []), callback)
							})
							.catch(err => callback(err))
					}
				: () => {
						fnResult = _sqlite[method](...(args || []), callback)
					}
			let busyRetry = RETRY_COUNT
			// We need to consume `this` from sqlite3 callback
			// eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
			const self = this
			const callback = function (
				this: {lastID: number | string; changes: unknown} | void,
				err?: ExtendedError,
				out?: any
			) {
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
					const error: ExtendedError = new Error(
						`${name}: sqlite3: ${err.message}`
					)
					error.code = err.code
					reject(error)
				} else
					resolve(
						returnFn
							? fnResult
							: returnThis
								? {lastID: this!.lastID, changes: this!.changes}
								: out
					)
			}
			if (!_sqlite[method])
				return callback(
					{message: `method ${method} not supported`} as any,
					null
				)
			runQuery()
		})
		if (shouldDebug) {
			const query = isStmt ? obj._name : String(args[0]).replaceAll(/\s+/g, ' ')
			const notify = (error?: ExtendedError, output?: any) => {
				if (dbgQ.enabled)
					dbgQ(
						'%s',
						`${name}.${method} ${
							error ? `SQLite error: ${error.message} ` : ''
						}${query} ${argsToString(args, isStmt)} ${(
							duration as number
						).toLocaleString(undefined, {
							maximumFractionDigits: 2,
						})}ms${output ? ` ${outputToString(output, method)}` : ''}`
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
					} as CallData)
				if (error) throw error
				return output
			}
			return result.then(output => notify(undefined, output), notify)
		}
		return result
	}

	/** Return all rows for the given query. */
	all(sqlQuery: string, vars?: SQLiteParam[]): Promise<SQLiteRow[]>
	all(
		sqlQuery: TemplateStringsArray,
		...vars: SQLiteParam[]
	): Promise<SQLiteRow[]>
	all(...args: any[]): Promise<SQLiteRow[]> {
		return this._call('all', args, this._sqlite, this.name)
	}

	/** Return the first row for the given query. */
	get(sqlQuery: string, vars?: SQLiteParam[]): Promise<SQLiteRow | undefined>
	get(
		sqlQuery: TemplateStringsArray,
		...vars: SQLiteParam[]
	): Promise<SQLiteRow | undefined>
	get(...args: any[]): Promise<SQLiteRow | undefined> {
		return this._call('get', args, this._sqlite, this.name)
	}

	/** Run the given query and return the metadata. */
	run(sqlQuery: string, vars?: SQLiteParam[]): Promise<SQLiteMeta>
	run(
		sqlQuery: TemplateStringsArray,
		...vars: SQLiteParam[]
	): Promise<SQLiteMeta>
	run(...args: any[]): Promise<SQLiteMeta> {
		return this._call('run', args, this._sqlite, this.name, true)
	}

	/**
	 * Run the given query and return nothing. Slightly more efficient than
	 * {@link run}
	 */
	exec(sqlQuery: string, vars?: SQLiteParam[]): Promise<void>
	exec(sqlQuery: TemplateStringsArray, ...vars: SQLiteParam[]): Promise<void>
	async exec(...args: any[]): Promise<void> {
		await this._call('exec', args, this._sqlite, this.name)
	}

	/**
	 * Register an SQL statement for repeated running. This will store the SQL and
	 * will prepare the statement with SQLite whenever needed, as well as finalize
	 * it when closing the connection.
	 */
	prepare(sqlQuery: string, name?: string): Statement {
		const s = this._statements.get(sqlQuery)
		if (s) return s
		// This will self-register
		return new StatementImpl(this, sqlQuery, name)
	}

	/**
	 * Run the given query and call the function on each item. Note that
	 * node-sqlite3 seems to just fetch all data in one go.
	 */
	each(sqlQuery: string, cb: DBEachCallback): Promise<void>
	each(sqlQuery: string, vars: SQLiteParam[], cb: DBEachCallback): Promise<void>
	each(...args: any[]): Promise<void> {
		const lastIdx = args.length - 1
		if (typeof args[lastIdx] === 'function') {
			// err is always null, no reason to have it
			const onRow = args[lastIdx]
			args[lastIdx] = (_: any, row: SQLiteRow) => onRow(row)
		}
		return this._call('each', args, this._sqlite, this.name)
	}

	/**
	 * Returns the data_version, which increases when other connections write to
	 * the database.
	 */
	async dataVersion(): Promise<number> {
		if (!this._sqlite) await this._hold('dataVersion')
		if (!this._dataVSql)
			this._dataVSql = this.prepare('PRAGMA data_version', 'dataV')
		const result = await this._dataVSql.get([])
		return (result && (result.data_version as number)) || 0
	}

	/**
	 * Returns or sets the user_version, an arbitrary integer connected to the
	 * database.
	 */
	async userVersion(newV: number): Promise<void>
	async userVersion(): Promise<number>
	async userVersion(newV?: number): Promise<number | void> {
		if (!this._sqlite) await this._hold('userVersion')
		// Can't prepare or use pragma with parameter
		if (newV !== undefined)
			await this._call(
				'exec',
				[`PRAGMA user_version=${Number(newV)}`],
				this._sqlite,
				this.name
			)
		if (!this._userVSql)
			this._userVSql = this.prepare('PRAGMA user_version', 'userV')
		const result = await this._userVSql.get([])
		return newV === undefined
			? (result && (result.user_version as number)) || 0
			: undefined
	}

	transactionP: Promise<void> = Promise.resolve()

	/**
	 * Run a function in an immediate transaction. Within a connection, the
	 * invocations are serialized, and between connections it uses busy retry
	 * waiting. During a transaction, the database can still be read.
	 */
	async withTransaction(fn: () => Promise<void> | void): Promise<void> {
		if (this.readOnly) throw new Error(`${this.name}: DB is readonly`)
		if (!this._sqlite) await this._hold('transaction')

		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	async __withTransaction(
		fn: () => Promise<void> | void,
		busyRetry = RETRY_COUNT
	): Promise<void> {
		try {
			this.inTransaction = true
			await this.exec(`BEGIN IMMEDIATE`)
			this.emit('begin')
		} catch (error: any) {
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

	async _vacuumStep(): Promise<void> {
		if (!this._sqlite) return
		const {vacuumInterval, vacuumPageCount} = this.options
		if (!this._freeCountSql)
			this._freeCountSql = this.prepare('PRAGMA freelist_count', 'freeCount')
		const result = await this._freeCountSql.get([])
		const left = (result && (result.freelist_count as number)) || 0
		// leave some free pages in there
		if (left < vacuumPageCount * 20 || !this._sqlite) return
		await this.exec(`PRAGMA incremental_vacuum(${vacuumPageCount})`)
		const t = setTimeout(() => this._vacuumStep(), vacuumInterval * 1000)
		t.unref()
	}

	/** Access to sql templating function */
	static sql = {
		quoteId: quoteSqlId,
	} as unknown as () => {quoteId: (id: SQLiteParam) => string} & SqlTag

	/** Access to sql templating function */
	sql(): {quoteId: (id: SQLiteParam) => string} & SqlTag {
		return sql as unknown as {quoteId: (id: SQLiteParam) => string} & SqlTag
	}
}

export default SQLiteImpl
