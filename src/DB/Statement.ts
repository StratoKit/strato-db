// Implements prepared statements that auto-close and recreate
// Only a single preparation per sql string
// No parameter binding at creation for now
// Somewhat based on node-sqlite3 by Kriasoft, LLC

import debug from 'debug'
import type {Statement as SQLiteStatement} from 'sqlite3'
import SQLite, {
	SQLiteChangesMeta,
	SQLiteEachCallback,
	SQLiteInterpolation,
	SQLiteRow,
} from './SQLite'

const dbg = debug('strato-db/DB:stmt')

// Puts interpolation object in an array to call _call correctly
const arr = (vars: SQLiteInterpolation): any[] => {
	if (!vars) return []
	if (Array.isArray(vars)) {
		return vars
	}
	if (!vars || typeof vars !== 'object')
		throw new TypeError('SQLParams[] or {...} interpolations object expected')
	return [vars]
}

let id = 0
/**
 * A prepared SQL statement, tied to a SQLite instance.
 * Creates the backing sqlite3 instance as-needed.
 */
class Statement<
	O extends SQLiteRow = SQLiteRow,
	I extends SQLiteInterpolation = any
> {
	/** The SQLite instance it's bound to */
	declare db: SQLite
	/** A name for debugging */
	declare name: string

	declare _sql: string
	declare _name: string
	declare _stmt?: SQLiteStatement

	constructor(db: SQLite, sql: string, name?: string) {
		db.statements[sql] = this as Statement
		this._sql = sql
		this.db = db
		this._name = `{${id++}${name ? ` ${name}` : ''}}`
		this.name = `${db.name}${this._name}`
	}

	static isStatement(stmt): stmt is Statement {
		return stmt instanceof Statement
	}

	get isStatement() {
		return true
	}

	get sql() {
		return this._sql
	}

	_P = Promise.resolve()

	/**
	 * Wrap the function with a refresh call.
	 *
	 * @param fn  The function to wrap.
	 * @returns The result of the function.
	 */
	_wrap<T>(fn: () => T) {
		// Always verify _stmt and fail if init fails
		const wrapped = () => this._refresh().then(fn)
		// Run invocations in-order but ignore output
		this._P = this._P.then(wrapped, wrapped) as Promise<void>
		return this._P as Promise<Awaited<T>>
	}

	_refresh = async () => {
		if (this._stmt) return
		this._stmt = await this.db._call<SQLiteStatement>(
			'prepare',
			[this._sql],
			this.db._sqlite,
			this.name,
			false,
			true
		)

		this.db.statements[this._sql] = this as Statement
	}

	/** Closes the statement, removing it from the SQLite instance */
	finalize() {
		delete this.db.statements[this._sql]
		const {_stmt} = this
		if (!_stmt) return Promise.resolve()
		return this._wrap(
			(): Promise<void> =>
				new Promise((resolve, reject) => {
					this._stmt = undefined
					_stmt.finalize(err => {
						if (err) {
							if (!this._stmt) this._stmt = _stmt
							return reject(err)
						}
						dbg(`${this.name} finalized`)
						resolve()
					})
				})
		)
	}

	/**
	 * Run the statement and return the metadata.
	 *
	 * @param [vars]  The variables to be bound to the statement.
	 * @returns an object with `lastID` and `changes`
	 */
	async run(vars?: I) {
		return this._wrap(() =>
			this.db._call<SQLiteChangesMeta>('run', arr(vars), this, this.name, true)
		)
	}

	/**
	 * Return the first row for the statement result.
	 *
	 * @param [vars]  The variables to be bound to the statement.
	 */
	async get(vars?: I) {
		return this._wrap(() =>
			this.db._call<O | undefined>('get', arr(vars), this, this.name).finally(
				() =>
					this._stmt &&
					new Promise(resolve => {
						this._stmt?.reset(() => {
							resolve(this)
						})
					})
			)
		)
	}

	/**
	 * Return all result rows for the statement.
	 *
	 * @param [vars]  The variables to be bound to the statement.
	 * @returns The results.
	 */
	async all(vars?: I) {
		return this._wrap(() =>
			this.db._call<O[]>('all', arr(vars), this, this.name)
		)
	}

	/**
	 * Run the callback on each row of the result.
	 *
	 * @param vars  The variables to be bound to the statement.
	 * @returns The count of rows processed.
	 */
	async each(vars: I, onRow: SQLiteEachCallback<O>) {
		if (typeof onRow !== 'function')
			throw new Error(`signature is .each(args Array, cb Function)`)
		// err is always null, no reason to have it
		const cb = (_err, row) => onRow(row)
		const args = arr(vars)
		args.push(cb)
		return this._wrap(() =>
			this.db._call<number>('each', args, this, this.name)
		)
	}
}

export default Statement
