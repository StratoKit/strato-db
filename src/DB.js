/* eslint-disable no-console */
import path from 'path'
import {sortBy} from 'lodash'
import debug from 'debug'
import openDB from './sqlite-promised'
import {performance} from 'perf_hooks'
import {inspect} from 'util'

const dbg = debug('stratokit/DB')
const dbgQ = debug('stratokit/DB:query')

const RETRY_COUNT = 3

const wait = ms => new Promise(r => setTimeout(r, ms))

const getDuration = ts =>
	(performance.now() - ts).toLocaleString({
		maximumFractionDigits: 2,
	})

const objToString = o =>
	inspect(o, {compact: true, breakLength: Infinity}).slice(0, 200)

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
// Note: since we switch db methods at runtime, internal methods
// should always use `this._db`
class DB {
	constructor({file, readOnly, verbose, onWillOpen, name, ...rest} = {}) {
		if (Object.keys(rest).length)
			throw new Error(`Unknown options ${Object.keys(rest).join(',')}`)
		this.file = file || ':memory:'
		this.name = `${name || path.basename(this.file, '.db')}|${connId++}`
		this.readOnly = readOnly
		this.options = {onWillOpen, verbose, migrations: []}
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
	}

	// Store all your models here, by name
	store = {}

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
			options: {verbose, onWillOpen},
		} = this
		if (onWillOpen) await onWillOpen()

		dbg(`${this.name} opening ${this.file}`)
		const realDb = await openDB(file, {
			verbose,
			// SQLITE3 OPEN_READONLY: 1
			mode: readOnly ? 1 : undefined,
		})
		// Configure lock management
		realDb.driver.configure('busyTimeout', 15000)
		if (this.file !== ':memory:' && !this.readOnly) {
			const [{journal_mode: journalMode}] = await realDb.all(
				'PRAGMA journal_mode = wal'
			)
			if (journalMode !== 'wal') {
				console.error(
					`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
				)
			}
		}
		// Some sane settings
		await realDb.run('PRAGMA foreign_keys = ON')
		await realDb.run('PRAGMA recursive_triggers = ON')
		await realDb.run('PRAGMA journal_size_limit = 4000000')

		this._realDb = realDb
		this._db = {
			store: {},
			get models() {
				if (process.env.NODE_ENV !== 'production' && !this.warnedModel)
					console.error(
						new Error('!!! db.models is deprecated, use db.store instead')
					)
				return this.store
			},
		}
		for (const method of ['all', 'exec', 'get', 'prepare', 'run']) {
			this._db[method] = (...args) => {
				if (Array.isArray(args[0])) {
					args = sql(...args)
				}
				let result, now
				if (dbgQ.enabled) now = performance.now()
				try {
					result = realDb[method](...args)
				} catch (error) {
					console.error(
						`!!! synchronous error for ${this.name}.${method}`,
						error
					)
					throw error
				}
				if (dbgQ.enabled) {
					const what = `${this.name}.${method}`
					const q = String(args[0]).replace(/\s+/g, ' ')
					const v = args[1] ? objToString(args[1]) : ''
					if (result && result.then) {
						// eslint-disable-next-line promise/catch-or-return
						result.then(
							o => {
								const d = getDuration(now)
								const out =
									method !== 'exec' && method !== 'run'
										? `-> ${objToString(o)}`
										: ''
								return dbgQ(`${what} ${q} ${v} ${d}ms ${out}`)
							},
							err => {
								const d = getDuration(now)
								dbgQ(`!!! FAILED ${err.message} ${what} ${q} ${v}${d}ms `)
							}
						)
					} else {
						const d = getDuration(now)
						dbgQ(`${what} ${q} ${v} ${d}ms -> ${objToString(result)}`)
					}
				}
				return result
			}
		}
		this._db.each = this._realEach.bind(this)
		if (readOnly) {
			this._db.withTransaction = () => {
				const error = new Error(`DB ${this.name} is readonly`)
				console.error('!!! RO', error)
				throw error
			}
		} else {
			this._db.withTransaction = this._withTransaction.bind(this)
			await this.runMigrations()
		}
		this._db.dataVersion = () =>
			realDb.get('PRAGMA data_version').then(o => o.data_version)
		// Make all accesses direct to the DB object, bypass .hold()
		for (const method of [
			'all',
			'exec',
			'get',
			'prepare',
			'run',
			'each',
			'dataVersion',
			'withTransaction',
		]) {
			this[method] = this._db[method]
		}
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
		if (this._dbP) {
			await this._dbP
		}
		dbg('closing', this.file)
		if (this._realDb) await this._realDb.close()
		// Reset all
		for (const m of [
			'dbP',
			'db',
			'all',
			'exec',
			'get',
			'prepare',
			'run',
			'each',
			'dataVersion',
			'withTransaction',
			'migrationsRan',
		]) {
			delete this[m]
		}
		this.dbP = new Promise(resolve => {
			this._resolveDbP = resolve
		})
		return this
	}

	async _hold(method, args) {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		const db = await this.openDB()
		return db[method](...args)
	}

	all(...args) {
		return this._hold('all', args)
	}

	exec(...args) {
		return this._hold('exec', args)
	}

	get(...args) {
		return this._hold('get', args)
	}

	prepare(...args) {
		return this._hold('prepare', args)
	}

	run(...args) {
		return this._hold('run', args)
	}

	each(...args) {
		return this._hold('_realEach', args)
	}

	dataVersion() {
		return this.openDB().then(db => db.dataVersion())
	}

	withTransaction(...args) {
		return this._hold('_withTransaction', args)
	}

	_realEach(...args) {
		const onRow = args.pop()
		// err is always null, no reason to have it
		return this._realDb.each(...args, (_, row) => onRow(row))
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
		await this._db.exec(`
			CREATE TABLE IF NOT EXISTS _migrations(
				runKey TEXT,
				ts DATETIME,
				up BOOLEAN
			);
		`)
		const didRun = {}
		await this._db.each(
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
		await this._db.run(
			...sql`INSERT INTO _migrations VALUES (${runKey}, ${ts}, ${up})`
		)
	}

	async __withTransaction(fn, count = RETRY_COUNT) {
		try {
			await this._db.run(`BEGIN IMMEDIATE`)
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
			await this._db.run(`ROLLBACK`)
			throw error
		}
		await this._db.run(`END`)
		return result
	}

	transactionP = Promise.resolve()

	_withTransaction(fn) {
		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	async runMigrations() {
		const migrations = sortBy(this.options.migrations, ({runKey}) => runKey)
		await this._withTransaction(async () => {
			const didRun = await this._getRanMigrations()
			for (const model of Object.values(this.store))
				if (model.setWritable) model.setWritable(true)
			for (const {runKey, up} of migrations) {
				if (!didRun[runKey]) {
					dbg(this.name, 'start migration', runKey)
					await up(this._db) // eslint-disable-line no-await-in-loop
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
