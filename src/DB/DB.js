/* eslint-disable no-console */
import path from 'path'
import {sortBy} from 'lodash'
import debug from 'debug'
import {performance} from 'perf_hooks'
import {inspect} from 'util'
import sqlite3 from 'sqlite3'
import Statement from './Statement'

const dbg = debug('stratokit/DB')
const dbgQ = debug('stratokit/DB:query')

const RETRY_COUNT = 3

const wait = ms => new Promise(r => setTimeout(r, ms))

const getDuration = ts =>
	(performance.now() - ts).toLocaleString({
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

// db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json = ${obj}JSON`
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
// This class lazily creates the db
// TODO event emitter proxying the sqlite3 events
class DB {
	constructor({
		file,
		readOnly,
		verbose,
		onWillOpen,
		name,
		_sqlite,
		_store = {},
		_migrations = [],
		...rest
	} = {}) {
		if (Object.keys(rest).length)
			throw new Error(`Unknown options ${Object.keys(rest).join(',')}`)
		this.file = file || ':memory:'
		this.name = `${name || path.basename(this.file, '.db')}|${connId++}`
		this.readOnly = readOnly
		this._isChild = !!_sqlite
		this._sqlite = _sqlite
		this.store = _store
		this.options = {onWillOpen, verbose, migrations: _migrations}
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
	}

	get models() {
		if (process.env.NODE_ENV !== 'production' && !this.warnedModel)
			console.error(
				new Error('!!! db.models is deprecated, use db.store instead')
			)
		return this.store
	}

	addModel(Model, options) {
		const model = new Model({
			...options,
			db: this,
		})
		if (this.store[model.name])
			throw new TypeError(`Model name ${model.name} was already added`)
		this.store[model.name] = model
		return model
	}

	static sql = sql

	sql = sql

	async _openDB() {
		const {
			file,
			readOnly,
			_isChild,
			options: {verbose, onWillOpen},
		} = this
		if (_isChild) throw new Error(`Child dbs cannot be opened`)

		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${this.file}`)

		let _sqlite
		await new Promise((resolve, reject) => {
			if (verbose) sqlite3.verbose()
			const mode = readOnly
				? sqlite3.OPEN_READONLY
				: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
			_sqlite = new sqlite3.Database(file, mode, err => {
				if (err) reject(err)
				else resolve()
			})
		}).catch(error => {
			throw new Error(`${file}: ${error.message}`)
		})

		// Wait 15s for locks
		_sqlite.configure('busyTimeout', 15000)

		const childDb = new DB({
			file: this.file,
			readOnly: this.readOnly,
			name: this.name,
			_sqlite,
			_store: this.store,
			_migrations: this.options.migrations,
		})

		// Journaling mode WAL
		if (this.file !== ':memory:' && !this.readOnly) {
			const {journal_mode: journalMode} = await childDb.get(
				'PRAGMA journal_mode = wal'
			)
			if (journalMode !== 'wal') {
				console.error(
					`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
				)
			}
		}
		// Some sane settings
		await childDb.exec(`
			PRAGMA foreign_keys = ON;
			PRAGMA recursive_triggers = ON;
			PRAGMA journal_size_limit = 4000000
		`)
		if (process.env.NODE_ENV === 'development' && Date.now() & 1)
			// 50% of the time, return unordered selects in reverse order (chosen once per open)
			await childDb.exec('PRAGMA reverse_unordered_selects = ON')

		if (!readOnly) {
			this._optimizerToken = setInterval(
				() => this.exec(`PRAGMA optimize`),
				2 * 3600 * 1000
			)
			this._optimizerToken.unref()
			await childDb.runMigrations()
			this.migrationsRan = true
		}

		this._sqlite = _sqlite

		dbg(`${this.name} ${file} opened`)

		return this
	}

	openDB() {
		const {_resolveDbP} = this
		if (_resolveDbP) {
			this._resolveDbP = null
			this._dbP = this._openDB().then(result => {
				_resolveDbP(result)
				this._dbP = null
				return result
			})
		}
		return this.dbP
	}

	async close() {
		dbg('closing', this.file)
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
		const {_sqlite} = this
		this._sqlite = null
		clearInterval(this._optimizerToken)
		if (this._dbP) await this._dbP
		if (_sqlite) await this._call('close', [], _sqlite)

		return this
	}

	async _hold(method) {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		await this.openDB()
		return this._sqlite
	}

	async _call(method, args, _sqlite, returnThis, returnFn) {
		const {name} = this
		if (!_sqlite) _sqlite = await this._hold(method, args)
		if (Array.isArray(args[0])) {
			args = sql(...args)
			if (!args[1].length) args.pop()
		}
		const now = dbgQ.enabled ? performance.now() : undefined
		let fnResult
		const result = new Promise((resolve, reject) => {
			// We need to consume `this` from sqlite3 callback
			fnResult = _sqlite[method](...args, function(err, out) {
				if (err) reject(new Error(`${name}: sqlite3: ${err.message}`))
				else resolve(returnFn ? fnResult : returnThis ? this : out)
			})
		})
		if (dbgQ.enabled) {
			const what = `${name}.${method}`
			const q = String(args[0]).replace(/\s+/g, ' ')
			const v = args[1] ? objToString(args[1]) : ''
			// eslint-disable-next-line promise/catch-or-return
			result.then(
				o => {
					if (returnFn) o = fnResult
					const d = getDuration(now)
					const out =
						method !== 'exec' && method !== 'run' ? `-> ${objToString(o)}` : ''
					return dbgQ(`${what} ${q} ${v} ${d}ms ${out}`)
				},
				err => {
					const d = getDuration(now)
					dbgQ(`!!! FAILED ${err.message} ${what} ${q} ${v}${d}ms `)
				}
			)
		}
		return result
	}

	all(...args) {
		return this._call('all', args, this._sqlite)
	}

	get(...args) {
		return this._call('get', args, this._sqlite)
	}

	run(...args) {
		return this._call('run', args, this._sqlite, true)
	}

	async exec(...args) {
		await this._call('exec', args, this._sqlite)
		return this
	}

	async prepare(...args) {
		const prepared = await this._call(
			'prepare',
			args,
			this._sqlite,
			false,
			true
		)
		return new Statement(this, prepared)
	}

	each(...args) {
		const lastIdx = args.length - 1
		if (typeof args[lastIdx] === 'function') {
			// err is always null, no reason to have it
			const onRow = args[lastIdx]
			args[lastIdx] = (_, row) => onRow(row)
		}
		return this._call('each', args, this._sqlite)
	}

	async dataVersion() {
		if (!this._sqlite) await this._hold('dataVersion')
		return new Promise((resolve, reject) =>
			this._sqlite.get('PRAGMA data_version', (err, o) => {
				if (err) reject(err)
				else resolve(o.data_version)
			})
		)
	}

	async withTransaction(fn) {
		if (this.readOnly) throw new Error(`${this.name}: DB is readonly`)
		if (!this._sqlite) await this._hold('transaction')

		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	registerMigrations(name, migrations) {
		if (this.migrationsRan) {
			throw new Error('migrations already done')
		}
		for (const key of Object.keys(migrations)) {
			let obj = migrations[key]
			if (typeof obj === 'function') {
				obj = {up: obj}
			} else if (!obj.up) {
				throw new Error(
					`Migration ${key} for "${name}" must be a function or have an "up({db, model, ...rest})" attribute`
				)
			}
			// Separate with space, it sorts before other things
			const runKey = `${key} ${name}`
			this.options.migrations.push({
				...obj,
				runKey,
			})
		}
	}

	async _getRanMigrations() {
		await this.exec(`
			CREATE TABLE IF NOT EXISTS _migrations(
				runKey TEXT,
				ts DATETIME,
				up BOOLEAN
			);
		`)
		const didRun = {}
		await this.each(
			`
				SELECT runKey, max(ts) AS ts, up FROM _migrations
				GROUP BY runKey
				HAVING up = 1
			`,
			({runKey}) => {
				didRun[runKey] = true
			}
		)
		return didRun
	}

	async _markMigration(runKey, up) {
		const ts = Math.round(Date.now() / 1000)
		up = up ? 1 : 0
		await this.run`INSERT INTO _migrations VALUES (${runKey}, ${ts}, ${up})`
	}

	async __withTransaction(fn, count = RETRY_COUNT) {
		try {
			await this.exec(`BEGIN IMMEDIATE`)
		} catch (error) {
			if (error.code === 'SQLITE_BUSY' && count) {
				// Transaction already running
				if (count === RETRY_COUNT) dbg('DB is busy, retrying')
				await wait(Math.random() * 1000 + 200)
				return this.__withTransaction(fn, count - 1)
			}
			throw error
		}
		let result
		try {
			result = await fn()
		} catch (error) {
			if (process.env.NODE_ENV !== 'test')
				console.error('transaction failure, rolling back', error)
			await this.exec(`ROLLBACK`)
			throw error
		}
		await this.exec(`END`)
		return result
	}

	transactionP = Promise.resolve()

	async runMigrations() {
		const migrations = sortBy(this.options.migrations, ({runKey}) => runKey)
		await this.withTransaction(async () => {
			const didRun = await this._getRanMigrations()
			for (const model of Object.values(this.store))
				if (model.setWritable) model.setWritable(true)
			for (const {runKey, up} of migrations) {
				if (!didRun[runKey]) {
					dbg(this.name, 'start migration', runKey)
					await up(this) // eslint-disable-line no-await-in-loop
					dbg(this.name, 'done migration', runKey)
					await this._markMigration(runKey, 1) // eslint-disable-line no-await-in-loop
				}
			}
			for (const model of Object.values(this.store))
				if (model.setWritable) model.setWritable(false)
		})
		this.migrationsRan = true
	}
}

export default DB
