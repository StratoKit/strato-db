// Slightly stripped and adapted from kriasoft/node-sqlite
import sqlite3 from 'sqlite3'
import Database from './Database'

/**
 * Opens SQLite database.
 *
 * @returns Promise<Database> A promise that resolves to an instance of SQLite database client.
 */
const openDB = async (filename, {mode = null, verbose = false} = {}) => {
	if (verbose) sqlite3.verbose()

	let driver
	await new Promise((resolve, reject) => {
		const cb = err => {
			if (err) reject(err)
			else resolve()
		}
		driver = mode
			? new sqlite3.Database(filename, mode, cb)
			: new sqlite3.Database(filename, cb)
	})

	return new Database(driver)
}

export default openDB
