// Implements prepared statements that auto-close and recreate
// Only a single preparation per sql string
// No parameter binding at creation for now
// Somewhat based on node-sqlite3 by Kriasoft, LLC

import debug from 'debug'
import type {
	default as SQLite,
	SQLiteEachCallback,
	SQLiteInterpolation,
	SQLiteRow,
} from './SQLite'
const dbg = debug('strato-db/DB:stmt')

/** Allow not passing vars if no parameters */
type StatementArgs<I extends SQLiteInterpolation | []> = I extends
	| undefined
	| []
	| Record<any, never>
	? [] | [undefined]
	: [I]

let id = 0
class Statement<
	O extends SQLiteRow | undefined = SQLiteRow | undefined,
	I extends SQLiteInterpolation | [] = SQLiteInterpolation | [],
	AlwaysResult extends boolean = boolean,
> {
	declare _sql: string
	declare _name: string
	declare _stmt?: import('sqlite3').Statement
	declare db: SQLite
	declare name: string

	constructor(db: SQLite, sql, name) {
		db.statements[sql] = this
		this._sql = sql
		this.db = db
		this._name = `{${id++}${name ? ` ${name}` : ''}}`
		this.name = `${db.name}${this._name}`
	}

	get isStatement() {
		return true
	}

	get sql() {
		return this._sql
	}

	_P: Promise<unknown> = Promise.resolve()

	/**
	 * Wrap the function with a refresh call.
	 *
	 * @param fn  The function to wrap.
	 * @returns The result of the function.
	 */
	_wrap(fn: () => Promise<unknown> | unknown): Promise<unknown> {
		// Always verify _stmt and fail if init fails
		const wrapped = () => this._refresh().then(fn)
		// Run invocations in-order but ignore output
		this._P = this._P.then(wrapped, wrapped)
		return this._P
	}

	_refresh = async () => {
		if (this._stmt) return
		this._stmt = await this.db._call(
			'prepare',
			[this._sql],
			this.db._sqlite,
			this.name,
			false,
			true
		)

		this.db.statements[this._sql] = this
	}

	finalize() {
		delete this.db.statements[this._sql]
		const {_stmt} = this
		if (!_stmt) return Promise.resolve()
		return this._wrap(
			() =>
				new Promise<void>((resolve, reject) => {
					delete this._stmt
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
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns - an object with `lastID` and `changes`
	 */
	async run(
		...vars: StatementArgs<I>
	): Promise<{lastID: number; changes: number}>
	async run(vars?: I): Promise<{lastID: number; changes: number}> {
		return this._wrap(() =>
			this.db._call(
				'run',
				Array.isArray(vars) ? vars : [vars],
				this,
				this.name,
				true
			)
		) as any
	}

	/**
	 * Return the first row for the statement result.
	 *
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns {Promise<Object | null>} - the result or falsy if missing.
	 */
	async get(
		...vars: StatementArgs<I>
	): Promise<AlwaysResult extends true ? O : O | undefined>
	async get(vars?: I): Promise<AlwaysResult extends true ? O : O | undefined> {
		return this._wrap(() =>
			this.db
				._call('get', Array.isArray(vars) ? vars : [vars], this, this.name)
				.finally(
					() =>
						this._stmt &&
						new Promise(resolve => {
							this._stmt!.reset(() => {
								resolve(this)
							})
						})
				)
		) as any
	}

	/**
	 * Return all result rows for the statement.
	 *
	 * @param [vars]  - the variables to be bound to the statement.
	 * @returns {Promise<Object[]>} - the results.
	 */
	async all(...vars: StatementArgs<I>): Promise<O[]>
	async all(vars?: I): Promise<O[]> {
		return this._wrap(() =>
			this.db._call('all', Array.isArray(vars) ? vars : [vars], this, this.name)
		) as any
	}

	async each(args: I, onRow: SQLiteEachCallback<NonNullable<O>>) {
		if (typeof onRow !== 'function')
			throw new Error(`signature is .each(args Array, cb Function)`)
		return this._wrap(() =>
			this.db._call(
				'each',
				// err is always null, no reason to have it
				[args, (_, row) => onRow(row)] as any,
				this,
				this.name
			)
		)
	}
}

export default Statement
