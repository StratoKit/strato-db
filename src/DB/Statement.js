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
		this._db = db
		this.name = `${db.name}{${id++}${name ? ` ${name}` : ''}}}`
	}

	get isStatement() {
		return true
	}

	get sql() {
		return this._sql
	}

	P = Promise.resolve()

	_wrap(fn) {
		if (!this._stmt) this.P = this.P.then(this._refresh)
		this.P = this.P.then(fn, fn)
		return this.P
	}

	_refresh = async () => {
		if (this._stmt) return
		this._stmt = await this._db._call(
			'prepare',
			[this._sql],
			this._db._sqlite,
			this.name,
			false,
			true
		)

		this._db.statements[this._sql] = this
	}

	finalize() {
		delete this._db.statements[this._sql]
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

	async run(args) {
		return this._wrap(() => this._db._call('run', args, this, this.name, true))
	}

	async get(args) {
		return this._wrap(() =>
			this._db._call('get', args, this, this.name).finally(
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

	async all(args) {
		return this._wrap(() => this._db._call('all', args, this, this.name))
	}

	async each(args, onRow) {
		if (typeof onRow !== 'function')
			throw new Error(`signature is .each(args Array, cb Function)`)
		// err is always null, no reason to have it
		return this._wrap(() =>
			this._db._call('each', [args, (_, row) => onRow(row)], this, this.name)
		)
	}
}

export default Statement
