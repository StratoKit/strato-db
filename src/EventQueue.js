// Note that this queue doesn't use any transactions by itself, to prevent deadlocks
// Pass `forever: true` to keep Node running while waiting for events
import debug from 'debug'
import JsonModel from './JsonModel'

const dbg = debug('strato-db/queue')

let warnedLatest

/**
 * An event queue, including history
 * @extends JsonModel
 */
class EventQueue extends JsonModel {
	/**
	 * @typedef Event
	 * @type {Object}
	 * @property {Number} v - the version
	 * @property {String} type - event type
	 * @property {Number} ts - ms since epoch of event
	 * @property {*} [data] - event data
	 * @property {Object} [result] - event processing result
	 */

	/**
	 * Creates a new EventQueue model, called by DB
	 * @constructor
	 * @param  {string} [name='history'] - the table name
	 * @param  {boolean} [forever] - should getNext poll forever?
	 * @param  {boolean} [withViews] - add views to the database to assist with inspecting the data
	 * @param  {Object} [...rest] - other params are passed to JsonModel
	 */
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

	/**
	 * Replace existing event data
	 * @param  {Event} event - the new event
	 * @returns {Promise<void>} - Promise for set completion
	 */
	set(event) {
		if (!event.v) {
			throw new Error('cannot use set without v')
		}
		this.currentV = -1
		return super.set(event)
	}

	latestVersion() {
		if (process.env.NODE_ENV !== 'production' && !warnedLatest) {
			const {stack} = new Error(
				'EventQueue: latestVersion() is deprecated, use getMaxV instead'
			)
			// eslint-disable-next-line no-console
			console.error(stack)
			warnedLatest = true
		}
		return this.getMaxV()
	}

	/**
	 * Get the highest version stored in the queue
	 * @returns {Promise<number>} - the version
	 */
	async getMaxV() {
		if (this._addP) await this._addP

		const dataV = await this.db.dataVersion()
		if (this.currentV >= 0 && this._dataV === dataV) {
			// If there was no change on other connections, currentV is correct
			return this.currentV
		}
		this._dataV = dataV
		if (this._maxSql?.db !== this.db)
			this._maxSql = this.db.prepare(
				`SELECT MAX(v) AS v from ${this.quoted}`,
				'maxV'
			)
		const lastRow = await this._maxSql.get()
		this.currentV = Math.max(this.knownV, lastRow.v || 0)
		return this.currentV
	}

	_addP = null

	/**
	 * Atomically add an event to the queue
	 * @param  {string} type - event type
	 * @param  {*} [data] - event data
	 * @param  {Number} [ts=Date.now()] - event timestamp, ms since epoch
	 * @returns {Promise<Event>} - Promise for the added event
	 */
	add(type, data, ts) {
		if (!type || typeof type !== 'string')
			return Promise.reject(new Error('type should be a non-empty string'))
		ts = Number(ts) || Date.now()

		// We need to guarantee same-process in-order insertion, the sqlite3 lib doesn't do it :(
		this._addP = (this._addP || Promise.resolve()).then(async () => {
			// Store promise so getMaxV can get the most recent v
			// Note that it replaces the promise for the previous add
			// sqlite-specific: INTEGER PRIMARY KEY is also the ROWID and therefore the lastID and v
			if (this._addSql?.db !== this.db)
				this._addSql = this.db.prepare(
					`INSERT INTO ${this.quoted}(type,ts,data) VALUES (?,?,?)`,
					'add'
				)
			const {lastID: v} = await this._addSql.run([
				type,
				ts,
				JSON.stringify(data),
			])

			this.currentV = v

			const event = {v, type, ts, data}
			dbg(`queued`, v, type)
			if (this._nextAddedResolve) {
				this._nextAddedResolve(event)
			}
			return event
		})
		return this._addP
	}

	_nextAddedP = null

	_nextAddedResolve = event => {
		if (!this._resolveNAP) return
		clearTimeout(this._addTimer)
		this._NAPresolved = true
		this._resolveNAP(event)
	}

	// promise to wait for next event with timeout
	_makeNAP() {
		if (this._nextAddedP && !this._NAPresolved) return
		this._nextAddedP = new Promise(resolve => {
			this._resolveNAP = resolve
			this._NAPresolved = false
			// Timeout after 10s so we can also get events from other processes
			this._addTimer = setTimeout(this._nextAddedResolve, 10000)
			// if possible, mark the timer as non-blocking for process exit
			// some mocking libraries might forget to add unref()
			if (!this.forever && this._addTimer && this._addTimer.unref)
				this._addTimer.unref()
		})
	}

	/**
	 Get the next event after v (gaps are ok).
	 The wait can be cancelled by `.cancelNext()`.
	 * @param  {number} [v=0] the version
	 * @param  {boolean} [noWait] do not wait for the next event
	 * @returns {Promise<Event>} the event if found
	 */
	async getNext(v = 0, noWait = false) {
		let event
		if (!noWait) dbg(`${this.name} waiting unlimited until >${v}`)
		do {
			this._makeNAP()
			// eslint-disable-next-line no-await-in-loop
			const currentV = await this.getMaxV()
			event =
				v < currentV
					? // eslint-disable-next-line no-await-in-loop
					  await this.searchOne(null, {
							where: {'v > ?': [Number(v)]},
							sort: {v: 1},
					  })
					: null
			if (event || noWait) break
			// Wait for next one from this process
			// eslint-disable-next-line no-await-in-loop
			event = await this._nextAddedP
			if (event === 'CANCEL') return
			// Ignore previous events
			if (v && event && event.v < v) event = null
		} while (!event)
		return event
	}

	/**
	 * Cancel any pending `.getNext()` calls
	 */
	cancelNext() {
		if (!this._resolveNAP) return
		this._resolveNAP('CANCEL')
	}

	/**
	 * Set the latest known version.
	 * New events will have higher versions.
	 * @param  {number} v - the last known version
	 */
	setKnownV(v) {
		// set the sqlite autoincrement value
		// Try changing current value, and insert if there was no change
		// This doesn't need a transaction, either one or the other runs and
		// both are sent in the same command to nothing will run in between
		this.db.runOnceOnOpen(db =>
			db
				.exec(
					`
					UPDATE sqlite_sequence SET seq = ${v} WHERE name = ${this.quoted};
					INSERT INTO sqlite_sequence (name, seq)
						SELECT ${this.quoted}, ${v} WHERE NOT EXISTS
							(SELECT changes() AS change FROM sqlite_sequence WHERE change <> 0);
				`
				)
				.catch(error => {
					// eslint-disable-next-line no-console
					console.error(`setKnownV: could not update sequence`, error)
					db.close()
				})
		)
		this.currentV = Math.max(this.currentV, v)
		this.knownV = v
	}
}

export default EventQueue
