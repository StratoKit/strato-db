/**
 * somewhat based on node-sqlite3 by Kriasoft, LLC
 */

class Statement {
	constructor(db, stmt) {
		this._db = db
		this.stmt = stmt
		this._sqlite = db._sqlite
	}

	async refresh() {
		if (!this._db._sqlite) {
			await this._db.openDB()
		} else if (this._db._sqlite === this._sqlite) {
			return
		}
		Object.assign(this, await this._db.prepare(this.sql))
	}

	get sql() {
		return this.stmt.sql
	}

	get lastID() {
		return this.stmt.lastID
	}

	get changes() {
		return this.stmt.changes
	}

	async bind(...params) {
		await this.refresh()
		return this._db._call('bind', params, this.stmt, true)
	}

	reset() {
		return new Promise(resolve => {
			this.stmt.reset(() => {
				resolve(this)
			})
		})
	}

	finalize() {
		return new Promise((resolve, reject) => {
			this.stmt.finalize(err => {
				if (err) reject(err)
				else resolve()
			})
		})
	}

	async run(...params) {
		await this.refresh()
		return this._db._call('run', params, this.stmt, true)
	}

	async get(...params) {
		await this.refresh()
		return this._db._call('get', params, this.stmt)
		// TODO maybe change the semantics to reset after get
	}

	async all(...params) {
		await this.refresh()
		return this._db._call('all', params, this.stmt)
	}

	each(...args) {
		const lastIdx = args.length - 1
		if (typeof args[lastIdx] === 'function') {
			// err is always null, no reason to have it
			const onRow = args[lastIdx]
			args[lastIdx] = (_, row) => onRow(row)
		}
		return this._call('each', args, this.stmt)
	}
}

export default Statement
