import debug from 'debug'
import type {DBCallback, DBMigrations, DBModel, DBOptions} from '../../types'
import {DEV, deprecated} from '../lib/warning'
import SQLite from './SQLite'

const dbg = debug('strato-db/DB')

type _Migration = {
	runKey: string
	up: DBCallback
	ts?: number
}
export const _getRanMigrations = async (
	db: SQLite
): Promise<Record<string, boolean>> => {
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
			didRun[runKey!] = true
		}
	)
	return didRun
}

const _markMigration = async (db: SQLite, runKey: string, up: 0 | 1) => {
	const ts = Math.round(Date.now() / 1000)
	await db.run`INSERT INTO "{sdb} migrations" VALUES (${runKey}, ${ts}, ${up})`
}

/**
 * DB adds model management and migrations to Wrapper. The migration state is
 * kept in the table ""{sdb} migrations"".
 */
class DBImpl extends SQLite {
	migrations: _Migration[] = []

	constructor({
		migrations = [],
		onBeforeMigrations,
		...options
	}: DBOptions = {}) {
		const onDidOpen = options.readOnly
			? options.onDidOpen
			: async db => {
					if (onBeforeMigrations) await onBeforeMigrations(db)
					await this.runMigrations(db)
					if (options.onDidOpen) await options.onDidOpen(db)
				}
		super({...options, onDidOpen})
		this.migrations = migrations
	}

	get models() {
		if (DEV) deprecated(`use db.store instead of db.models`)
		return this.store
	}

	/**
	 * Add a model to the DB, which will manage one or more tables in the SQLite
	 * database. The model should use the given `db` instance at creation time.
	 *
	 * @param Model - A class.
	 * @param options - Options passed during Model creation.
	 * @returns The created Model instance.
	 */
	addModel(Model: DBModel, options: object): object {
		const model = new Model({
			...options,
			db: this,
		})
		if (this.store[model.name])
			throw new TypeError(`Model name ${model.name} was already added`)
		this.store[model.name] = model
		return model
	}

	migrationsRan = false

	/**
	 * Register an object with migrations.
	 *
	 * @param name - The name under which to register these migrations.
	 * @param migrations - The migrations object.
	 */
	registerMigrations(name: string, migrations: DBMigrations): void {
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
			this.migrations.push({
				...obj,
				runKey,
			})
		}
	}

	/**
	 * Runs the migrations in a transaction and waits for completion.
	 *
	 * @param db - An opened SQLite instance.
	 * @returns Promise for completed migrations.
	 */
	async runMigrations(db: SQLite): Promise<void> {
		const {store} = this
		const sortedMigrations = this.migrations.sort((a, b) =>
			a.runKey.localeCompare(b.runKey)
		)
		await db.withTransaction(async () => {
			const didRun = await _getRanMigrations(db)
			for (const model of Object.values(store))
				if (model.setWritable) model.setWritable(true)
			for (const {runKey, up} of sortedMigrations) {
				if (!didRun[runKey]) {
					dbg(this.name, 'start migration', runKey)
					await up(db)
					dbg(this.name, 'done migration', runKey)
					await _markMigration(db, runKey, 1)
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

export default DBImpl
