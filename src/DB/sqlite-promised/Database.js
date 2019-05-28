/*
 * SQLite client library for Node.js applications
 *
 * Copyright © 2016 Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

// eslint-disable-next-line no-unused-vars,import/no-unresolved,import/extensions
import sqlite3 from 'sqlite3' // import sqlite3 for jsdoc type information only
import Statement from './Statement'

class Database {
	/*
	 * Initializes a new instance of the database client.
	 * @param {sqlite3.Database} driver An instance of SQLite3 driver library.
	 * @param {String} name DB name to use in error reporting.
	 */
	constructor(driver, name) {
		this.driver = driver
		this.name = name
	}

	// Add tracing to the SQLite errors
	//
	_handleError = err => {
		const error = new Error(`${this.name}: ${err.message}`)
		throw error
	}

	/*
	 * Close the database.
	 * @returns {Promise} void on completion
	 */
	close() {
		return new Promise((resolve, reject) => {
			this.driver.close(err => {
				if (err) reject(err)
				else resolve()
			})
		}).catch(this._handleError)
	}

	/*
	 * Register listeners for Sqlite3 events
	 *
	 * @callback sqlEventListener
	 *
	 * @param {'trace'|'profile'|'error'|'open'|'close'} eventName `sqlite3` event
	 * @param {sqlEventListener} listener trigger listener function
	 */
	on(eventName, listener) {
		this.driver.on(eventName, listener)
	}

	run(...params) {
		return new Promise((resolve, reject) => {
			this.driver.run(
				...params,
				// Use `function` to access given `this`
				// Per https://github.com/mapbox/node-sqlite3/wiki/API#databaserunsql-param--callback
				function(err) {
					if (err) reject(err)
					else resolve(new Statement(this))
				}
			)
		}).catch(this._handleError)
	}

	get(...params) {
		return new Promise((resolve, reject) => {
			this.driver.get(...params, (err, row) => {
				if (err) reject(err)
				else resolve(row)
			})
		}).catch(this._handleError)
	}

	all(...params) {
		return new Promise((resolve, reject) => {
			this.driver.all(...params, (err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			})
		}).catch(this._handleError)
	}

	/*
	 * Runs all the SQL queries in the supplied string. No result rows are retrieved.
	 */
	exec(sql) {
		return new Promise((resolve, reject) => {
			this.driver.exec(sql, err => {
				if (err) reject(err)
				else resolve(this)
			})
		}).catch(this._handleError)
	}

	each(...params) {
		return new Promise((resolve, reject) => {
			this.driver.each(...params, (err, rowsCount = 0) => {
				if (err) reject(err)
				else resolve(rowsCount)
			})
		}).catch(this._handleError)
	}

	prepare(...params) {
		return new Promise((resolve, reject) => {
			const stmt = this.driver.prepare(...params, err => {
				if (err) reject(err)
				else resolve(new Statement(stmt))
			})
		}).catch(this._handleError)
	}

	/*
	 * Set a configuration option for the database.
	 */
	configure(option, value) {
		this.driver.configure(option, value)
	}
}

export default Database
