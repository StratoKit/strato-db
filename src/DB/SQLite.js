// @ts-check
import path from 'path'
import debug from 'debug'
import {performance} from 'perf_hooks'
import {inspect} from 'util'
import sqlite3 from 'sqlite3'
import Statement from './Statement'
import {EventEmitter} from 'events'

const dbg = debug('strato-db/sqlite')
const dbgQ = dbg.extend('query')

const RETRY_COUNT = 10

const wait = ms => new Promise(r => setTimeout(r, ms))
const busyWait = () => wait(200 + Math.floor(Math.random() * 1000))

const getDuration = ts =>
	(performance.now() - ts).toLocaleString(undefined, {
		maximumFractionDigits: 2,
	})

const objToString = o => {
	const s = inspect(o, {compact: true, breakLength: Infinity})
	return s.length > 250 ? `${s.slice(0, 250)}… (${s.length}b)` : s
}

const quoteSqlId = s => `"${s.toString().replace(/"/g, '""')}"`

export const valToSql = v => {
	if (typeof v === 'boolean') return v ? '1' : '0'
	if (typeof v === 'number') return v.toString()
	if (v == null) return 'NULL'
	return `'${v.toString().replace(/'/g, "''")}'`
}

const isBusyError = err => err.code === 'SQLITE_BUSY'

/**
 * sql provides templating for SQL.
 *
 * Example:
 *   `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json = ${obj}JSON` ``
 *
 * is converted to
 *   `db.all('select * from "foo" where t = ? and json = ?', [bar, JSON.stringify(obj)])`
 *
 * @param  {Array<string>} template - the template
 * @param  {...any} interpolations - the template interpolations
 * @returns {array} - [out, variables] for consumption by the call method
 */
export const sql = (...args) => {
	const strings = args[0]
	let out = strings[0]
	const vars = []
	for (let i = 1; i < strings.length; i++) {
		const val = args[i]
		let str = strings[i]

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

let connId = 1

/**
 * SQLite is a wrapper around a single SQLite connection (via node-sqlite3).
 * It provides a Promise API, lazy opening, auto-cleaning prepared statements
 * and safe ``db.run`select * from foo where bar=${bar}` `` templating.
 * @extends EventEmitter
 */
class SQLite extends EventEmitter {
	/**
	 * @constructor
	 * @param  {object} options -
	 * @param  {string} [options.file] path to db file
	 * @param  {boolean} [options.readOnly] open read-only
	 * @param  {boolean} [options.verbose] verbose errors
	 * @param  {function} [options.onWillOpen] called before opening
	 * @param  {function} [options.onDidOpen] called after opened
	 * @param  {string} [options.name] name for debugging
	 * @param  {boolean} [options.autoVacuum] run incremental vacuum
	 * @param  {number} [options.vacuumInterval] seconds between incremental vacuums
	 * @param  {number} [options.vacuumPageCount] number of pages to clean per vacuum
	 * @param  {object} [options._sqlite] sqlite instance for child dbs
	 * @param  {object} [options._store={}] models registry for child dbs
	 * @param  {object} [options._statements={}] statements registry for child dbs
	 */
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
	} = {}) {
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
	}

	static sql = sql

	sql = sql

	/** @type {{fn:function, stack:string}[]} */
	_queuedOnOpen = []

	async _openDB() {
		const {
			file,
			readOnly,
			_isChild,
			_queuedOnOpen,
			options: {verbose, onWillOpen, autoVacuum},
		} = this
		if (_isChild)
			throw new Error(
				`Child dbs cannot be opened. Perhaps you kept a prepared statement from a child db?`
			)

		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${this.file}`)

		const _sqlite = await new Promise((resolve, reject) => {
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
			file: this.file,
			readOnly: this.readOnly,
			name: this.name,
			_sqlite,
			_store: this.store,
		})

		// in dev mode, 50% of the time, return unordered selects in reverse order (chosen once per open)
		if (process.env.NODE_ENV === 'development' && Math.random() > 0.5)
			await childDb.exec('PRAGMA reverse_unordered_selects = ON')

		if (!this.readOnly) {
			// Make sure we have WAL journaling - cannot be done in transaction
			if (this.file !== ':memory:') {
				const {journal_mode: mode} = await childDb.get('PRAGMA journal_mode')
				if (mode !== 'wal') {
					const {journal_mode: journalMode} = await childDb
						.get('PRAGMA journal_mode = wal')
						.catch(err => {
							if (!isBusyError(err)) throw err
						})
					if (journalMode !== 'wal') {
						// eslint-disable-next-line no-console
						console.error(
							`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
						)
					}
				}
			}

			if (autoVacuum) {
				const {auto_vacuum: mode} = await childDb.get(`PRAGMA auto_vacuum`)
				if (mode !== 2) {
					await childDb
						.exec(`PRAGMA auto_vacuum=INCREMENTAL; VACUUM`)
						.catch(err => {
							if (!isBusyError(err)) throw err
							this.options.autoVacuum = false
						})
				}
				const {vacuumInterval} = this.options
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

			if (this.options.onDidOpen) await this.options.onDidOpen(childDb)
			for (const {fn, stack} of this._queuedOnOpen) {
				try {
					// eslint-disable-next-line no-await-in-loop
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
	 * Force opening the database instead of doing it lazily on first access
	 * @returns {Promise<void>} - a promise for the DB being ready to use
	 */
	open() {
		const {_resolveDbP} = this
		if (_resolveDbP) {
			this._openingDbP = this._openDB().finally(() => {
				this._openingDbP = null
			})
			_resolveDbP(this._openingDbP)
			this._resolveDbP = null
			this.dbP.catch(() => this.close())
		}
		return this.dbP
	}

	/**
	 * Runs the passed function once, either immediately if the connection is
	 * already open, or when the database will be opened next.
	 * Note that if the function runs immediately, its return value is returned.
	 * If this is a Promise, it is the caller's responsibility to handle errors.
	 * Otherwise, the function will be run once after onDidOpen, and errors
	 * will cause the open to fail.
	 * @param {(db: SQLite)=>void} fn
	 * @returns {*} Either the function return value or undefined
	 */
	runOnceOnOpen(fn) {
		if (this.isOpen) {
			// note that async errors are not handled
			return fn(this)
		}
		this._queuedOnOpen.push({fn, stack: new Error('').stack})
	}

	/**
	 * Close the database connection, including the prepared statements
	 * @returns {Promise<void>} - a promise for the DB being closed
	 */
	async close() {
		if (this._openingDbP) {
			dbg(`${this.name} waiting for open to complete before closing`)
			await this._openingDbP.catch(() => {})
		}
		if (!this._sqlite) return
		const {_sqlite} = this
		this._sqlite = null

		if (!this._isChild) dbg(`${this.name} closing`)

		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
		if (this._optimizerToken) {
			clearInterval(this._optimizerToken)
			this._optimizerToken = null
		}
		if (this._vacuumToken) {
			clearInterval(this._vacuumToken)
			this._vacuumToken = null
		}

		const stmts = Object.values(this.statements)
		if (stmts.length)
			await Promise.all(stmts.map(stmt => stmt.finalize().catch(() => {})))

		// We only want to close our own statements, not the db
		if (this._isChild) {
			dbg(`${this.name} child db closed`)
			return
		}

		await this._call('close', [], _sqlite, this.name)
		dbg(`${this.name} closed`)
	}

	async _hold(method) {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		await this.open()
		return this._sqlite
	}

	// eslint-disable-next-line max-params
	async _call(method, args, obj, name, returnThis, returnFn) {
		const isStmt = obj && obj.isStatement
		let _sqlite
		if (!obj) _sqlite = await this._hold(method)
		else if (isStmt) _sqlite = obj._stmt
		else _sqlite = obj
		if (!_sqlite)
			throw new Error(`${name}: sqlite or statement not initialized`)

		// Template strings
		if (!isStmt && Array.isArray(args[0])) {
			args = sql(...args)
			if (!args[1].length) args.pop()
		}

		const now = dbgQ.enabled ? performance.now() : undefined
		let fnResult
		const result = new Promise((resolve, reject) => {
			// eslint-disable-next-line prefer-const
			let cb
			const runQuery = () => {
				fnResult = _sqlite[method](...(args || []), cb)
			}
			let busyRetry = RETRY_COUNT
			// We need to consume `this` from sqlite3 callback
			cb = function (err, out) {
				if (err) {
					if (isBusyError(err) && busyRetry--) {
						return busyWait().then(runQuery)
					}
					const error = new Error(`${name}: sqlite3: ${err.message}`)
					// @ts-ignore
					error.code = err.code
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
			fnResult = _sqlite[method](...(args || []), cb)
		})
		if (dbgQ.enabled) {
			const what = `${name}.${method}`
			const q = isStmt ? `` : String(args[0]).replace(/\s+/g, ' ')
			const v = args
				? isStmt
					? objToString(args)
					: objToString(args[isStmt ? 0 : 1])
				: ''
			// eslint-disable-next-line promise/catch-or-return
			result.then(
				o => {
					if (returnFn) o = fnResult
					const d = getDuration(now)
					const out =
						method !== 'exec' && method !== 'prepare'
							? `-> ${objToString(o)}`
							: ''
					return dbgQ(`${what} ${q} ${v} ${d}ms ${out}`)
				},
				err => {
					const d = getDuration(now)
					dbgQ(`${what} SQLite error: ${err.message} ${q} ${v}${d}ms `)
				}
			)
		}
		return result
	}

	/**
	 * Return all rows for the given query
	 * @param {string} sql - the SQL statement to be executed
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<Array<object>>} - the results
	 */
	all(...args) {
		return this._call('all', args, this._sqlite, this.name)
	}

	/**
	 * Return the first row for the given query
	 * @param {string} sql - the SQL statement to be executed
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<(object|null)>} - the result or falsy if missing
	 */
	get(...args) {
		return this._call('get', args, this._sqlite, this.name)
	}

	/**
	 * Run the given query and return the metadata
	 * @param {string} sql - the SQL statement to be executed
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<object>} - an object with `lastID` and `changes`
	 */
	run(...args) {
		return this._call('run', args, this._sqlite, this.name, true)
	}

	/**
	 * Run the given query and return nothing. Slightly more efficient than {@link run}
	 * @param {string} sql - the SQL statement to be executed
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<void>} - a promise for execution completion
	 */
	async exec(...args) {
		await this._call('exec', args, this._sqlite, this.name)
	}

	/**
	 * Register an SQL statement for repeated running. This will store the SQL
	 * and will prepare the statement with SQLite whenever needed, as well as
	 * finalize it when closing the connection.
	 * @param {string} sql - the SQL statement to be executed
	 * @param {string} [name] - a short name to use in debug logs
	 * @returns {Statement} - the statement
	 */
	prepare(sql, name) {
		if (this.statements[sql]) return this.statements[sql]
		return new Statement(this, sql, name)
	}

	/**
	 * Run the given query and call the function on each item.
	 * Note that node-sqlite3 seems to just fetch all data in one go.
	 * @param {string} sql - the SQL statement to be executed
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @param {function(object): Promise<void>} cb - the function to call on each row
	 * @returns {Promise<void>} - a promise for execution completion
	 */
	each(...args) {
		const lastIdx = args.length - 1
		if (typeof args[lastIdx] === 'function') {
			// err is always null, no reason to have it
			const onRow = args[lastIdx]
			args[lastIdx] = (_, row) => onRow(row)
		}
		return this._call('each', args, this._sqlite, this.name)
	}

	/**
	 * Returns the data_version, which increases when other connections write
	 * to the database.
	 * @returns {Promise<number>} - the data version
	 */
	async dataVersion() {
		if (!this._sqlite) await this._hold('dataVersion')
		if (!this._dataVSql)
			this._dataVSql = this.prepare('PRAGMA data_version', 'dataV')
		const {data_version: v} = await this._dataVSql.get()
		return v
	}

	/**
	 * Returns or sets the user_version, an arbitrary integer connected
	 * to the database.
	 * @param {number} [newV] - if given, sets the user version
	 * @returns {Promise<(number|void)>} - the user version or nothing when setting
	 */
	async userVersion(newV) {
		if (!this._sqlite) await this._hold('userVersion')
		// Can't prepare or use pragma with parameter
		if (newV)
			return this._call(
				'exec',
				[`PRAGMA user_version=${Number(newV)}`],
				this._sqlite,
				this.name
			)
		if (!this._userVSql)
			this._userVSql = this.prepare('PRAGMA user_version', 'userV')
		const {user_version: v} = await this._userVSql.get()
		return v
	}

	transactionP = Promise.resolve()

	/**
	 * Run a function in an immediate transaction. Within a connection, the invocations
	 * are serialized, and between connections it uses busy retry waiting. During a
	 * transaction, the database can still be read.
	 * @param {function} fn - the function to call. It doesn't get any parameters
	 * @returns {Promise<void>} - a promise for transaction completion.
	 * @throws - when the transaction fails or after too many retries
	 */
	async withTransaction(fn) {
		if (this.readOnly) throw new Error(`${this.name}: DB is readonly`)
		if (!this._sqlite) await this._hold('transaction')

		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	async __withTransaction(fn, busyRetry = RETRY_COUNT) {
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

	async _vacuumStep() {
		if (!this._sqlite) return
		const {vacuumInterval, vacuumPageCount} = this.options
		if (!this._freeCountSql)
			this._freeCountSql = this.prepare('PRAGMA freelist_count', 'freeCount')
		const {freelist_count: left} = await this._freeCountSql.get()
		// leave some free pages in there
		if (left < vacuumPageCount * 20 || !this._sqlite) return
		await this.exec(`PRAGMA incremental_vacuum(${vacuumPageCount})`)
		const t = setTimeout(() => this._vacuumStep(), vacuumInterval * 1000)
		t.unref()
	}
}

export default SQLite
