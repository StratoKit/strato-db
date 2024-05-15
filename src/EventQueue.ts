// Note that this queue doesn't use any transactions by itself, to prevent deadlocks
// Pass `forever: true` to keep Node running while waiting for events
import debug from 'debug'
import Statement from './DB/Statement'
import JsonModel from './JsonModel'
import {
	JMBaseConfig,
	JMColumnDef,
	JMColumns,
	JMConfig,
	JMMigrationExtraArgs,
	JMModelName,
	JMSearchAttrs,
	JMSearchOptions,
	JMValue,
	MaybeId,
	WithId,
} from './JsonModel/JsonModel'

const dbg = debug('strato-db/queue')

let warnedLatest

export interface ESEvent<T extends string = string, D = unknown> {
	/** the version */
	v: number
	/** event type */
	type: T
	/** ms since epoch of event */
	ts: number
	/** event data */
	data?: D
	/** event processing result */
	result?: Record<string, Record<string, JMValue>>
}

const defaultColumns: JMColumns<'v'> = {
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

/**
 * An event queue, including history.
 */
class EventQueue<
	Event extends ESEvent = ESEvent,
	Config extends JMBaseConfig = JMBaseConfig,
	//
	// Inferred generics below
	//
	InputEvent extends MaybeId<Partial<Event>, 'v', number> = MaybeId<
		Partial<Event>,
		'v',
		number
	>,
	DBEvent extends WithId<Event, 'v', number> = WithId<Event, 'v', number>,
	Name extends JMModelName = Config['name'],
	Columns extends JMColumns<'v'> = Config['columns'] extends JMColumns<'v'>
		? Config['columns']
		: // If we didn't get a config, assume all keys are columns
		  {[colName in keyof DBEvent]: JMColumnDef},
	ColName extends string | 'v' | 'json' =
		| Extract<keyof Columns, string>
		| 'v'
		| 'json',
	SearchAttrs extends JMSearchAttrs<ColName> = JMSearchAttrs<ColName>,
	SearchOptions extends JMSearchOptions<ColName> = JMSearchOptions<ColName>,
	MigrationArgs extends
		JMMigrationExtraArgs = Config['migrationOptions'] extends JMMigrationExtraArgs
		? Config['migrationOptions']
		: JMMigrationExtraArgs,
	RealConfig extends JMConfig<'v', Event, MigrationArgs> = JMConfig<
		'v',
		Event,
		MigrationArgs
	>,
> extends JsonModel<
	Event,
	Config,
	'v',
	number,
	InputEvent,
	DBEvent,
	Name,
	Columns,
	ColName,
	SearchAttrs,
	SearchOptions,
	MigrationArgs,
	RealConfig
> {
	/** Latest known version */
	declare knownV: number
	/** Current version to our knowledge */
	declare currentV: number
	/** should getNext poll forever? */
	declare forever: boolean

	constructor({
		name = 'history',
		forever,
		withViews,
		...rest
	}: Omit<JMConfig<'v', Event, Config['migrationOptions']>, 'name'> & {
		/** should getNext poll forever? */
		forever?: boolean
		/** add views to the database to assist with inspecting the data */
		withViews?: boolean
		name?: JMModelName
	}) {
		const columns = {...defaultColumns}
		if (rest.columns)
			for (const [key, value] of Object.entries(rest.columns)) {
				if (!value) continue
				if (columns[key]) throw new TypeError(`Cannot override column ${key}`)
				columns[key] = value
			}
		const config: JMConfig<'v', Event, Config['migrationOptions']> = {
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
		}
		super(config as RealConfig)
		this.currentV = -1
		this.knownV = 0
		this.forever = !!forever
	}

	/**
	 * Replace existing event data.
	 *
	 * @param event  - the new event.
	 * @returns Promise for set completion.
	 */
	set<NoReturn extends boolean>(
		event: InputEvent,
		insertOnly?: boolean,
		noReturn?: NoReturn
	) {
		if (!event.v) {
			throw new Error('cannot use set without v')
		}
		this.currentV = -1
		return super.set<NoReturn>(event, insertOnly, noReturn)
	}

	/** @deprecated use .getMaxV() */
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

	declare _dataV: number
	declare _maxSql: Statement
	declare _addP: Promise<Event>

	/**
	 * Get the highest version stored in the queue.
	 *
	 * @returns The version.
	 */
	async getMaxV(): Promise<number> {
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
		const lastRow = (await this._maxSql.get())!.v as number
		this.currentV = Math.max(this.knownV, lastRow || 0)
		return this.currentV
	}

	declare _addSql: Statement

	/**
	 * Atomically add an event to the queue.
	 *
	 * @param type    - event type.
	 * @param [data]  - event data.
	 * @param [ts]    - event timestamp, ms since epoch.
	 * @returns - Promise for the added event.
	 */
	add(type: Event['type'], data: Event['data'], ts: number): Promise<Event> {
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

			const event = {v, type, ts, data} as Event
			dbg(`queued`, v, type)
			if (this._nextAddedResolve) {
				this._nextAddedResolve(event)
			}
			return event
		})
		return this._addP
	}

	declare _nextAddedP?: Promise<Event | 'CANCEL'>
	declare _resolveNAP?: (e: Event | 'CANCEL') => void
	declare _NAPresolved?: boolean
	declare _addTimer?: ReturnType<typeof setTimeout>

	_nextAddedResolve = event => {
		if (!this._resolveNAP) return
		clearTimeout(this._addTimer)
		this._NAPresolved = true
		this._resolveNAP(event)
	}

	// promise to wait for next event with timeout
	_makeNAP() {
		if (this._nextAddedP && !this._NAPresolved) return
		this._nextAddedP = new Promise<Event | 'CANCEL'>(resolve => {
			this._resolveNAP = resolve
			this._NAPresolved = false
			// Timeout after 10s so we can also get events from other processes
			this._addTimer = setTimeout(this._nextAddedResolve, 10_000)
			// if possible, mark the timer as non-blocking for process exit
			// some mocking libraries might forget to add unref()
			if (!this.forever && this._addTimer && this._addTimer.unref)
				this._addTimer.unref()
		})
	}

	/**
	 * Get the next event after v (gaps are ok).
	 * The wait can be cancelled by `.cancelNext()`.
	 *
	 * @param [v=0]     The version.
	 * @param [noWait]  Do not wait for the next event.
	 * @returns The event if found.
	 */
	async getNext(v = 0, noWait = false): Promise<DBEvent | undefined> {
		let event: DBEvent | undefined
		if (!noWait) dbg(`${this.name} waiting unlimited until >${v}`)
		do {
			this._makeNAP()
			const currentV = await this.getMaxV()
			event =
				v < currentV
					? await this.searchOne(null, {
							where: {'v > ?': [Number(v)]},
							sort: {v: 1},
					  } as unknown as SearchOptions)
					: undefined
			if (event || noWait) break
			// Wait for next one from this process
			event = (await this._nextAddedP) as DBEvent
			// @ts-expect-error 2367
			if (event === 'CANCEL') return
			// Ignore previous events
			if (v && event && event.v < v) event = undefined
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
	 *
	 * @param v  - the last known version.
	 */
	setKnownV(v: number) {
		// set the sqlite autoincrement value
		// Try changing current value, and insert if there was no change
		// This doesn't need a transaction, either one or the other runs and
		// both are sent in the same command so nothing will run in between
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
