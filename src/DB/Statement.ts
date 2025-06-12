// Implements prepared statements that auto-close and recreate
// Only a single preparation per sql string
// No parameter binding at creation for now
// Somewhat based on node-sqlite3 by Kriasoft, LLC

import debug from 'debug'
import type {
	DBEachCallback,
	SQLiteMeta,
	SQLiteParam,
	SQLiteRow,
	Statement,
} from '../../types'
import type {default as SQLiteInternal} from './SQLite'
const dbg = debug('strato-db/DB:stmt')

let id = 0
class StatementImpl implements Statement {
	db: SQLiteInternal
	_sql: string
	_name: string
	name: string
	_stmt: any
	_finalized: boolean = false

	constructor(db: SQLiteInternal, sql: string, name?: string) {
		// Register for closing
		db._statements.set(sql, this)
		this._sql = sql
		this.db = db
		this._name = `{${id++}${name ? ` ${name}` : ''}}`
		this.name = `${db.name}${this._name}`
	}

	get isStatement(): true {
		return true
	}

	get sql() {
		return this._sql
	}

	_P: Promise<any> = Promise.resolve()

	/** Wrap the function with a refresh call. */
	_wrap<F extends () => any>(fn: F): Promise<ReturnType<F>> {
		// Always verify _stmt and fail if init fails
		const wrapped = async () => {
			await this._refresh()
			return fn()
		}
		// Run invocations in-order but ignore output
		this._P = this._P.then(wrapped, wrapped)
		return this._P
	}

	async _refresh() {
		if (this._stmt) return
		this._stmt = await this.db._call(
			'prepare',
			[this._sql],
			this.db._sqlite,
			this.name,
			false,
			true
		)

		this.db._statements.set(this._sql, this)
	}

	async finalize() {
		this.db._statements.delete(this._sql)
		const {_stmt} = this
		if (!_stmt) return
		return this._wrap(
			() =>
				new Promise<void>((resolve, reject) => {
					delete this._stmt
					_stmt.finalize((err: Error) => {
						if (err) {
							this._stmt = _stmt
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
	 * @param vars - The variables to be bound to the statement.
	 * @returns An object with `lastID` and `changes`
	 */
	async run(vars: SQLiteParam[]): Promise<SQLiteMeta> {
		return this._wrap(() => this.db._call('run', vars, this, this.name, true))
	}

	/**
	 * Return the first row for the statement result.
	 *
	 * @param vars - The variables to be bound to the statement.
	 * @returns The result, or falsy if missing.
	 */
	async get(vars: SQLiteParam[]): Promise<SQLiteRow | undefined> {
		return this._wrap(() =>
			this.db._call('get', vars, this, this.name).finally(
				() =>
					this._stmt &&
					new Promise(resolve => {
						this._stmt.reset(() => {
							resolve(this)
						})
					})
			)
		)
	}

	/**
	 * Return all result rows for the statement.
	 *
	 * @param [vars] - The variables to be bound to the statement.
	 * @returns The results.
	 */
	async all(vars: SQLiteParam[]): Promise<SQLiteRow[]> {
		return this._wrap(() => this.db._call('all', vars, this, this.name))
	}

	async each(args: SQLiteParam[], onRow: DBEachCallback): Promise<void>
	async each(onRow: DBEachCallback): Promise<void>
	async each(args: SQLiteParam[] | DBEachCallback, onRow?: DBEachCallback) {
		if (typeof onRow !== 'function')
			throw new Error(`signature is .each(args Array, cb Function)`)
		// err is always null, no reason to have it
		return this._wrap(() =>
			this.db._call(
				'each',
				[args, (_: any, row: SQLiteRow) => onRow(row)],
				this,
				this.name
			)
		)
	}
}

export default StatementImpl
