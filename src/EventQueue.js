// TODO use PRAGMA data_version to detect changes from other processes
// Note that this queue doesn't use any transactions by itself to prevent deadlocks
import debug from 'debug'
import JsonModel from './JsonModel'

const dbg = debug('queue')

class EventQueue extends JsonModel {
	constructor({db, name = 'history', knownV, ...rest}) {
		super({
			...rest,
			db,
			name,
			idCol: 'v',
			columns: {
				v: {
					type: 'INTEGER',
					autoIncrement: true,
				},
				type: {
					type: 'TEXT',
					value: o => o.type,
					get: true,
					index: true,
					ignoreNull: false,
				},
				ts: {
					type: 'INTEGER',
					value: o => Number(o.ts) || Date.now(),
					get: true,
					index: true,
					ignoreNull: false,
				},
				data: {
					type: 'JSON',
					value: o => o.data,
					get: true,
				},
				result: {
					type: 'JSON',
					value: o => o.result,
					get: true,
				},
			},
		})
		this.knownV = Number(knownV) || 0
	}

	set(obj) {
		if (!obj.v) {
			throw new Error('cannot use set without v')
		}
		return super.set(obj)
	}

	async _getLatestVersion() {
		const lastRow = await this.db.get(`SELECT MAX(v) AS v from ${this.quoted}`)
		this.currentV = Math.max(this.knownV, lastRow.v || 0)
		return this.currentV
	}

	async add(type, data, ts) {
		if (this.knownV && !this._enforcedKnownV) {
			const v = Number(this.knownV)
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
			this._enforcedKnownV = true
		}
		if (!type || typeof type !== 'string') {
			throw new Error('type should be a non-empty string')
		}
		ts = Number(ts) || Date.now()
		// sqlite-specific: INTEGER PRIMARY KEY is also the ROWID and therefore the lastID
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
	}

	nextAddedP = null

	nextAddedResolve = null

	async getNext(v, once) {
		const beforeV = this.currentV
		let event = await this.searchOne(null, {
			where: {'v > ?': [Number(v) || 0]},
			sort: {v: 1},
		})
		if (once) return event
		while (!event) {
			// Maybe we got an insert between the request and the answer
			if (this.currentV !== beforeV) {
				return this.getNext(v)
			}
			// Wait for next one from this process
			if (!this.nextAddedP) {
				// eslint-disable-next-line promise/avoid-new
				this.nextAddedP = new Promise(resolve => {
					this.nextAddedResolve = () => {
						clearTimeout(this.addTimer)
						this.nextAddedResolve = null
						this.nextAddedP = null
						resolve()
					}
				})
				// Wait no more than 10s at a time so we can also get events from other processes
				// TODO if single process, don't time out
				this.addTimer = setTimeout(
					() => this.nextAddedResolve && this.nextAddedResolve(),
					10000
				)
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
}

export default EventQueue
