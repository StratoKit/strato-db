// @ts-check
// Implements prepared statements that auto-close and recreate
// Only a single preparation per sql string
// No parameter binding at creation for now
// Somewhat based on node-sqlite3 by Kriasoft, LLC

import debug from 'debug'
const dbg = debug('strato-db/DB:stmt')

let id = 0
class Statement {
	constructor(db, sql, name) {
		db.statements[sql] = this
		this._sql = sql
		this.db = db
		this.name = `${db.name}{${id++}${name ? ` ${name}` : ''}}}`
	}

	get isStatement() {
		return true
	}

	get sql() {
		return this._sql
	}

	P = Promise.resolve()

	/**
	 * @callback voidFn
	 * @returns {Promise<*>|*}
	 */
	/**
	 * wrap the function with a refresh call
	 * @param {voidFn} fn the function to wrap
	 * @returns {Promise<*>} the result of the function
	 */
	_wrap(fn) {
		if (!this._stmt) this.P = this.P.then(this._refresh)
		this.P = this.P.then(fn, fn)
		return this.P
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
				new Promise((resolve, reject) => {
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
	 * Run the statement and return the metadata
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<object>} - an object with `lastID` and `changes`
	 */
	async run(vars) {
		return this._wrap(() => this.db._call('run', vars, this, this.name, true))
	}

	/**
	 * Return the first row for the statement result
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<(object|null)>} - the result or falsy if missing
	 */
	async get(vars) {
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
	 * Return all result rows for the statement
	 * @param {Array<*>} [vars] - the variables to be bound to the statement
	 * @returns {Promise<Array<object>>} - the results
	 */
	async all(vars) {
		return this._wrap(() => this.db._call('all', vars, this, this.name))
	}

	async each(args, onRow) {
		if (typeof onRow !== 'function')
			throw new Error(`signature is .each(args Array, cb Function)`)
		// err is always null, no reason to have it
		return this._wrap(() =>
			this.db._call('each', [args, (_, row) => onRow(row)], this, this.name)
		)
	}
}

export default Statement
