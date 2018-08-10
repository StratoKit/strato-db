/**
 * SQLite client library for Node.js applications
 *
 * Copyright © 2016 Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

class Statement {
	constructor(stmt) {
		this.stmt = stmt
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

	bind(...params) {
		return new Promise((resolve, reject) => {
			this.stmt.bind(...params, err => {
				if (err) reject(err)
				else resolve(this)
			})
		})
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

	run(...params) {
		return new Promise((resolve, reject) => {
			this.stmt.run(...params, err => {
				if (err) reject(err)
				else resolve(this)
			})
		})
	}

	get(...params) {
		return new Promise((resolve, reject) => {
			this.stmt.get(...params, (err, row) => {
				if (err) reject(err)
				else resolve(row)
			})
		})
	}

	all(...params) {
		return new Promise((resolve, reject) => {
			this.stmt.all(...params, (err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			})
		})
	}

	each(...params) {
		return new Promise((resolve, reject) => {
			this.stmt.each(...params, (err, rowsCount = 0) => {
				if (err) reject(err)
				else resolve(rowsCount)
			})
		})
	}
}

export default Statement
