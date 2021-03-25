// @ts-check
/* eslint-disable no-console */
import {sortBy} from 'lodash'
import debug from 'debug'
import SQLite, {sql} from './SQLite'
import {DEV, deprecated} from '../lib/warning'

const dbg = debug('strato-db/DB')

export const _getRanMigrations = async db => {
	if (
		!(await db.get(`SELECT 1 FROM sqlite_master WHERE name="{sdb} migrations"`))
	) {
		await ((await db.get(
			`SELECT 1 FROM sqlite_master WHERE name="_migrations"`
		))
			? db.exec(`ALTER TABLE _migrations RENAME TO "{sdb} migrations"`)
			: db.exec(`CREATE TABLE "{sdb} migrations"(
				runKey TEXT,
				ts DATETIME,
				up BOOLEAN
			);`))
	}
	const didRun = {}
	await db.each(
		`
			SELECT runKey, max(ts) AS ts, up FROM "{sdb} migrations"
			GROUP BY runKey
			HAVING up = 1
		`,
		({runKey}) => {
			didRun[runKey] = true
		}
	)
	return didRun
}

const _markMigration = async (db, runKey, up) => {
	const ts = Math.round(Date.now() / 1000)
	up = up ? 1 : 0
	await db.run`INSERT INTO "{sdb} migrations" VALUES (${runKey}, ${ts}, ${up})`
}

/**
 * DB adds model management and migrations to Wrapper.
 * The migration state is kept in the table ""{sdb} migrations"".
 * @extends SQLite
 */
class DB extends SQLite {
	/**
	 * @param {object} options options for DB and SQLite
	 * @param {boolean} [options.readOnly] open the DB read-only
	 * @param {Array} [options.migrations] migration definitions
	 * @param {function} [options.onBeforeMigrations] called with the `db` before migrations run. Not called for read-only
	 * @param {function} [options.onDidOpen] called with the `db` after migrations ran. If readOnly is set, it runs after opening DB. The DB is open after this function resolves
	 */
	constructor({migrations = [], onBeforeMigrations, ...options} = {}) {
		const onDidOpen = options.readOnly
			? options.onDidOpen
			: async db => {
					if (onBeforeMigrations) await onBeforeMigrations(db)
					await this.runMigrations(db)
					if (options.onDidOpen) await options.onDidOpen(db)
			  }
		super({...options, onDidOpen})
		this.options.migrations = migrations
	}

	static sql = sql

	get models() {
		if (DEV) deprecated(`use db.store instead of db.models`)
		return this.store
	}

	/**
	 * Add a model to the DB, which will manage one or more tables in the SQLite database.
	 * The model should use the given `db` instance at creation time.
	 * @param {Object} Model - a class
	 * @param {object} options - options passed during Model creation
	 * @returns {object} - the created Model instance
	 */
	addModel(Model, options) {
		const model = new Model({
			...options,
			db: this,
		})
		if (this.store[model.name])
			throw new TypeError(`Model name ${model.name} was already added`)
		this.store[model.name] = model
		return model
	}

	/**
	 * Register an object with migrations
	 * @param {string} name - the name under which to register these migrations
	 * @param {Record<string, function | Record<string, function>>} migrations - the migrations object
	 * @returns {void}
	 */
	registerMigrations(name, migrations) {
		if (this.migrationsRan) {
			throw new Error('migrations already done')
		}
		for (const key of Object.keys(migrations)) {
			let obj = migrations[key]
			if (typeof obj === 'function') {
				obj = {up: obj}
			} else if (!obj.up) {
				throw new Error(
					`Migration ${key} for "${name}" must be a function or have an "up({db, model, ...rest})" attribute`
				)
			}
			// Separate with space, it sorts before other things
			const runKey = `${key} ${name}`
			this.options.migrations.push({
				...obj,
				runKey,
			})
		}
	}

	/**
	 * Runs the migrations in a transaction and waits for completion
	 * @param {SQLite} db - an opened SQLite instance
	 * @returns {Promise<void>} - promise for completed migrations
	 */
	async runMigrations(db) {
		const {store, options} = this
		const migrations = sortBy(options.migrations, ({runKey}) => runKey)
		await db.withTransaction(async () => {
			const didRun = await _getRanMigrations(db)
			for (const model of Object.values(store))
				if (model.setWritable) model.setWritable(true)
			for (const {runKey, up} of migrations) {
				if (!didRun[runKey]) {
					dbg(this.name, 'start migration', runKey)
					await up(db) // eslint-disable-line no-await-in-loop
					dbg(this.name, 'done migration', runKey)
					await _markMigration(db, runKey, 1) // eslint-disable-line no-await-in-loop
				}
			}
			for (const model of Object.values(store))
				if (model.setWritable) model.setWritable(false)
		})
		this.migrationsRan = true

		// Protect against store updates during migrations
		this.store = store
	}
}

export default DB
