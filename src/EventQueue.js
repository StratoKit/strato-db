// TODO use PRAGMA data_version to detect changes from other processes

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
		this.currentV = Math.max(this.knownV, lastRow.v || 1)
		return this.currentV
	}

	async add(type, data, ts) {
		if (this.knownV && !this._enforcedKnownV) {
			// set the sqlite autoincrement value
			await this.db
				.run(`INSERT OR ABORT INTO ${this.quoted}(v) VALUES (?)`, this.knownV)
				.then(
					() =>
						this.db.run(`DELETE FROM ${this.quoted} WHERE v = ?`, this.knownV),
					() => {}
				)
			this._enforcedKnownV = true
		}
		if (!type || typeof type !== 'string') {
			throw new Error('type should be a non-empty string')
		}
		ts = Number(ts) || Date.now()
		// sqlite-specific: INTEGER PRIMARY KEY is also the ROWID and therefore the lastID
		const {lastID: v} = await this.db.run(
			`INSERT INTO ${this.quoted}(type,ts,json) VALUES (?,?,?)`,
			[type, ts, JSON.stringify({data})]
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
