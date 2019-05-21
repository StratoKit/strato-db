// Note that this queue doesn't use any transactions by itself, to prevent deadlocks
// Pass `forever: true` to keep Node running while waiting for events
import debug from 'debug'
import JsonModel from './JsonModel'

const dbg = debug('queue')

class EventQueue extends JsonModel {
	constructor({name = 'history', forever, withViews, ...rest}) {
		const columns = {
			v: {
				type: 'INTEGER',
				autoIncrement: true,
			},
			type: {type: 'TEXT'},
			ts: {
				type: 'INTEGER',
				value: o => Number(o.ts) || Date.now(),
				index: 'ALL',
			},
			data: {type: 'JSON'},
			result: {type: 'JSON'},
			size: {type: 'INTEGER', default: 0, get: false},
		}
		if (rest.columns)
			for (const [key, value] of Object.entries(rest.columns)) {
				if (!value) continue
				if (columns[key]) throw new TypeError(`Cannot override column ${key}`)
				columns[key] = value
			}
		super({
			...rest,
			name,
			idCol: 'v',
			columns,
			migrations: {
				...rest.migrations,
				addTypeSizeIndex: ({db}) =>
					db.exec(
						`CREATE INDEX IF NOT EXISTS "history type,size" on history(type, size)`
					),
				'20190521_addViews': withViews
					? async ({db}) => {
							const historySchema = await db.all('PRAGMA table_info("history")')
							// This adds a field with data size, kept up-to-date with triggers
							if (!historySchema.some(f => f.name === 'size'))
								await db.exec(
									`ALTER TABLE history ADD COLUMN size INTEGER DEFAULT 0`
								)
							// The size WHERE clause is to prevent recursive triggers
							await db.exec(`
								DROP TRIGGER IF EXISTS "history size insert";
								DROP TRIGGER IF EXISTS "history size update";
								CREATE TRIGGER "history size insert" AFTER INSERT ON history BEGIN
									UPDATE history SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE v=new.v;
								END;
								CREATE TRIGGER "history size update" AFTER UPDATE ON history BEGIN
									UPDATE history SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE v=new.v AND size!=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0);
								END;

								DROP VIEW IF EXISTS _recentHistory;
								DROP VIEW IF EXISTS _historyTypes;
								CREATE VIEW _recentHistory AS
									SELECT datetime(ts/1000, "unixepoch", "localtime") AS t, *
									FROM history ORDER BY v DESC LIMIT 1000;
								CREATE VIEW _historyTypes AS
									SELECT
										type,
										COUNT(*) AS count,
										SUM(size)/1024/1024 AS MB
									FROM history GROUP BY type ORDER BY count DESC;
							`)
							// Recalculate size
							await db.exec(`UPDATE history SET size=0`)
					  }
					: null,
			},
		})
		this.currentV = -1
		this.knownV = 0
		this.forever = !!forever
	}

	set(obj) {
		if (!obj.v) {
			throw new Error('cannot use set without v')
		}
		this.currentV = -1
		return super.set(obj)
	}

	async _getLatestVersion() {
		if (this._addP) await this._addP

		const dataV = await this.db.dataVersion()
		if (this.currentV >= 0 && this._dataV === dataV) {
			// If there was no change on other connections, currentV is correct
			return this.currentV
		}
		this._dataV = dataV
		const lastRow = await this.db.get(`SELECT MAX(v) AS v from ${this.quoted}`)
		this.currentV = Math.max(this.knownV, lastRow.v || 0)
		return this.currentV
	}

	_addP = null

	add(type, data, ts) {
		if (!type || typeof type !== 'string')
			return Promise.reject(new Error('type should be a non-empty string'))
		ts = Number(ts) || Date.now()

		// We need to guarantee same-process in-order insertion, the sqlite3 lib doesn't do it :(
		this._addP = (this._addP || Promise.resolve()).then(async () => {
			// Store promise so _getLatestVersion can get the most recent v
			// Note that it replaces the promise for the previous add
			// sqlite-specific: INTEGER PRIMARY KEY is also the ROWID and therefore the lastID and v
			const {lastID: v} = await this.db.run(
				`INSERT INTO ${this.quoted}(type,ts,data) VALUES (?,?,?)`,
				[type, ts, JSON.stringify(data)]
			)

			this.currentV = v

			const event = {v, type, ts, data}
			dbg(`queued`, v, type)
			if (this.nextAddedResolve) {
				this.nextAddedResolve(event)
			}
			return event
		})
		return this._addP
	}

	nextAddedP = null

	nextAddedResolve = null

	async getNext(v, once) {
		const currentV = await this._getLatestVersion()
		let event
		event =
			v == null || v < currentV
				? await this.searchOne(null, {
						where: {'v > ?': [Number(v) || 0]},
						sort: {v: 1},
				  })
				: null
		if (once) return event
		while (!event) {
			// Wait for next one from this process
			if (!this.nextAddedP) {
				this.nextAddedP = new Promise(resolve => {
					this.nextAddedResolve = event => {
						clearTimeout(this.addTimer)
						this.nextAddedResolve = null
						this.nextAddedP = null
						resolve(event)
					}
				})
				// Wait no more than 10s at a time so we can also get events from other processes
				this.addTimer = setTimeout(
					() => this.nextAddedResolve && this.nextAddedResolve(),
					10000
				)
				// if possible, mark the timer as non-blocking for process exit
				// some mocking libraries might forget to add unref()
				if (!this.forever && this.addTimer && this.addTimer.unref)
					this.addTimer.unref()
			}
			// eslint-disable-next-line no-await-in-loop
			event = await this.nextAddedP
			if (event) {
				if (v && event.v < v) {
					event = null
				}
			} else {
				return this.getNext(v)
			}
		}
		return event
	}

	async setKnownV(v) {
		// set the sqlite autoincrement value
		// Try changing current value, and insert if there was no change
		// This doesn't need a transaction, either one or the other runs
		await this.db.exec(
			`
				UPDATE sqlite_sequence SET seq = ${v} WHERE name = ${this.quoted};
				INSERT INTO sqlite_sequence (name, seq)
					SELECT ${this.quoted}, ${v} WHERE NOT EXISTS
						(SELECT changes() AS change FROM sqlite_sequence WHERE change <> 0);
			`
		)
		this.currentV = Math.max(this.currentV, v)
		this.knownV = v
	}
}

export default EventQueue
