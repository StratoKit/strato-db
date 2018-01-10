/* eslint-disable no-console */
// TODO accept column def and create/add if needed, see
// pragma table_info("_migrations");
// cid|name|type|notnull|dflt_value|pk
// 0|runKey|STRING|0||0
// 1|ts|DATETIME|0||0
// 2|up|BOOLEAN|0||0
// TODO manage indexes, look at PRAGMA index_list
// TODO pragma recursive_triggers
// TODO in development, invert PRAGMA reverse_unordered_selects every so often
// TODO run PRAGMA quick_check at startup
// TODO pragma journal_size_limit setting, default to 2MB
// TODO PRAGMA schema.synchronous = extra
// TODO run pragma optimize every few hours
// TODO figure out if vacuum, pragma optimize and integrity_check can run while other processes are writing, if so run them in a separate connection
// TODO report: .dump should include user_version
// TODO put all metadata in stratodb_meta table, including queue version etc
// TODO prepared statements; calling them ensures serial access because of binding
//   => prepare, allow .get/all/etc; while those are active calls are queued up
// https://github.com/mapbox/node-sqlite3/wiki/API#statementbindparam--callback
import path from 'path'
import sqlite from 'sqlite'
import BP from 'bluebird'
import {sortBy} from 'lodash'
import debug from 'debug'

const dbg = debug('stratokit/DB')
const dbgQ = debug('stratokit/DB:query')

const quoteSqlId = s => `"${s.toString().replace(/"/g, '""')}"`
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

// This class lazily creates the db
// Note: since we switch db methods at runtime, internal methods
// should always use `this._db`
class DB {
	constructor({file, verbose} = {}) {
		this.file = file || ':memory:'
		this.name = path.basename(this.file, '.db')
		this.verbose = verbose
		this.migrations = []
	}

	// Store all your models here, by name
	models = {}
	addModel(Model, options) {
		const model = new Model({...options, db: this})
		if (this.models[model.name])
			throw new TypeError(`Model name ${model.name} was already added`)
		this.models[model.name] = model
		return model
	}

	static sql = sql
	sql = sql

	openDB() {
		if (this.dbP) {
			return this.dbP
		}
		const {file, verbose} = this

		dbg(`opening ${this.file}`)
		this.dbP = sqlite.open(file, {verbose, Promise: BP}).then(async realDb => {
			// Configure lock management
			realDb.driver.configure('busyTimeout', 15000)
			if (this.file !== ':memory:') {
				// TODO configure auto vacuum
				const [{journal_mode: journalMode}] = await realDb.all(
					'PRAGMA journal_mode = wal'
				)
				if (journalMode !== 'wal') {
					console.error(
						`!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
					)
				}
			}
			await realDb.run('PRAGMA foreign_keys = ON')

			this._realDb = realDb
			this._db = {models: {}}
			for (const method of ['all', 'exec', 'get', 'prepare', 'run']) {
				this._db[method] = (...args) => {
					if (Array.isArray(args[0])) {
						args = sql(...args)
					}
					if (dbgQ.enabled)
						dbgQ(
							this.name,
							method,
							...args.map(a => String(a).replace(/\s+/g, ' '))
						)
					return realDb[method](...args)
				}
			}
			this._db.each = this._realEach.bind(this)
			this._db.withTransaction = this._withTransaction.bind(this)
			await this.runMigrations()
			// Make all accesses direct to the DB object, bypass .hold()
			for (const method of [
				'all',
				'exec',
				'get',
				'prepare',
				'run',
				'each',
				'withTransaction',
			]) {
				this[method] = this._db[method]
			}
			dbg(`${file} opened`)
			return this
		})

		return this.dbP
	}
	async close() {
		if (this.dbP) {
			await this.dbP
		}
		dbg('closing', this.file)
		await this._realDb.close()
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
			'withTransaction',
			'migrationsRan',
		]) {
			delete this[m]
		}
		return this
	}
	_hold(method, args) {
		if (dbgQ.enabled) dbgQ('_hold', this.name, method)
		return this.openDB().then(db => db[method](...args))
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
	withTransaction(...args) {
		return this._hold('_withTransaction', args)
	}
	// TODO maybe this should return a ReadableStream or an async iterator
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
			const obj = migrations[key]
			if (!obj.up) {
				throw new Error(
					`Migration ${key} for "${name}" must have an "up(db)" function`
				)
			}
			// Separate with space, it sorts before other things
			const runKey = `${key} ${name}`
			this.migrations.push({...obj, runKey})
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
			...sql`
			INSERT INTO _migrations VALUES (${runKey}, ${ts}, ${up})
		`
		)
	}
	async __withTransaction(fn, count = 200) {
		// TODO keep a separate connection for transactions
		// TODO test multi-process
		// TODO run this synchronously

		try {
			await this._db.run(`BEGIN IMMEDIATE`)
		} catch (err) {
			if (err.errno === 1 && err.code === 'SQLITE_ERROR') {
				// Transaction already running
				if (count)
					return BP.delay(Math.random() * 1000 + 200).then(() =>
						this.__withTransaction(fn, count - 1)
					)
				throw err
			}
		}
		let result
		try {
			result = await fn()
		} catch (err) {
			console.error('transaction failure, rolling back', err)
			await this._db.run(`ROLLBACK`)
			throw err
		}
		await this._db.run(`END`)
		return result
	}

	transactionP = BP.resolve()

	_withTransaction(fn) {
		// Prevent overlapping transactions in this process
		const nextTransaction = () => this.__withTransaction(fn)

		this.transactionP = this.transactionP.then(nextTransaction, nextTransaction)
		return this.transactionP
	}

	async runMigrations() {
		const migrations = sortBy(this.migrations, ({runKey}) => runKey)
		const didRun = await this._getRanMigrations()
		await this._withTransaction(async () => {
			for (const {runKey, up} of migrations) {
				if (!didRun[runKey]) {
					dbg(this.name, 'start migration', runKey)
					await up(this._db) // eslint-disable-line no-await-in-loop
					dbg(this.name, 'done migration', runKey)
					await this._markMigration(runKey, 1) // eslint-disable-line no-await-in-loop
				}
			}
		})
		this.migrationsRan = true
	}
}

export default DB
