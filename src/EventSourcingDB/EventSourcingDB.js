/* eslint-disable require-atomic-updates */
// Event Sourcing DataBase
// * Only allows changes via messages that are stored and processed. This allows easy
//   replication, debugging and possibly even rollback
// * All the database tables participating should only be changed via events
// * The current version is stored in the SQLite `user_version` pragma and corresponds to the last event applied
// * Events describe facts that happened
//   * Think of them as newspaper clippings (that changed) or notes passed to the kitchen (this change requested)
//   * Should not require outside-db data to know how to handle them. Otherwise, split them in parts
// * Models store the data in a table an define preprocessor, reducer, applyEvent and deriver
// * Events:
//   * have version `v`, strictly ordered
//   * are added to `history` table in a single transaction, and then processed asynchronously in a separate transaction
//   * result of processing is stored in `history`
// * Each event is handled separately and serially in a single transaction:
//   * Preprocessors canonicalize the event
//   * Reducers get the table at `v-1` and the event, and describe the change for version `v` into a result object
//   * Once all reducers ran, the result objects are passed to model.applyEvent that changes the db
//   * Then the derivers run, they can post-process the db for calculating or caching
//     * Another option is a writable table with lazy user-space calculation. Delete entries in the deriver when they become invalid
//   * Then the transaction completes and the db is at version `v`
//   * Only applyEvent and deriver get a writeable db
// * Sub-events can be emitted at any point during processing
//   * for example USER_REGISTERED results in USER_ADD and EMAIL_OUT
//   * they are processed exactly like events but in the transaction of the parent event, in-process
//   * sub-events are stored in the event in a `sub` array, for reporting and debugging
// * To make changes to a table, change the reducer and rebuild the DB with the history, or migrate the table
//
// Extra notes:
// * preprocessors should always process events statelessly - processing again should be no problem
// * preprocessors, reducers, derivers should be pure, only working with the database state.
// * To incorporate external state in event processing, split the event up in multiple events recording current state, and listen to the db to know what to do

// * Ideally, reducers etc never fail
// * When they fail, the whole app hangs for new events
// * therefore all failures are exceptional and need intervention like app restart for db issues
// * => warn immediately with error when it happens
// * => make changing event easy, e.g. call queue.set from graphql or delete it by changing it to type 'HANDLE_FAILED' and rename .error

import debug from 'debug'
import {AsyncLocalStorage} from 'async_hooks'
import {isEmpty} from 'lodash'
import DB from '../DB'
import ESModel from './ESModel'
import EventQueue from '../EventQueue'
import EventEmitter from 'events'
import {settleAll} from '../lib/settleAll'
import {DEV, deprecated} from '../lib/warning'

const dbg = debug('strato-db/ESDB')

const wait = ms => new Promise(r => setTimeout(r, ms))

const registerHistoryMigration = (rwDb, queue) => {
	rwDb.registerMigrations('historyExport', {
		2018040800: {
			up: async db => {
				const oldTable = await db.all('PRAGMA table_info(history)')
				if (
					!(
						oldTable.length === 4 &&
						oldTable.some(c => c.name === 'json') &&
						oldTable.some(c => c.name === 'v') &&
						oldTable.some(c => c.name === 'type') &&
						oldTable.some(c => c.name === 'ts')
					)
				)
					return
				let allDone = Promise.resolve()
				await db.each('SELECT * from history', row => {
					allDone = allDone.then(() =>
						queue.set({...row, json: undefined, ...JSON.parse(row.json)})
					)
				})
				await allDone
				// not dropping table, you can do that yourself :)
				// eslint-disable-next-line no-console
				console.error(`!!! history table in ${rwDb.file} is no longer needed`)
			},
		},
	})
}

const errorToString = error => {
	const msg = error
		? error.stack || error.message || String(error)
		: new Error('missing error').stack
	return String(msg).replace(/\s+/g, ' ')
}

const fixupOldReducer = (name, reducer) => {
	if (!reducer) return
	if (reducer.length !== 1) {
		if (DEV)
			if (reducer.length === 0) {
				deprecated(
					'varargsReducer',
					`${name}: reducer has a single argument now, don't use ...args`
				)
			} else {
				deprecated(
					'oldReducer',
					`${name}: reducer has a single argument now, like preprocessor/deriver`
				)
			}
		const prev = reducer
		reducer = args => prev(args.model, args.event, args)
	}
	return reducer
}

/**
 * EventSourcingDB maintains a DB where all data is
 * atomically updated based on {@link Event events (free-form messages)}.
 * This is very similar to how Redux works in React.
 * @extends EventEmitter
 */
class EventSourcingDB extends EventEmitter {
	MAX_RETRY = 38 // this is an hour

	// eslint-disable-next-line complexity
	constructor({
		queue,
		models,
		queueFile,
		withViews = true,
		onWillOpen,
		onBeforeMigrations: prevOBM,
		onDidOpen,
		...dbOptions
	}) {
		super()
		// Prevent node warning about more than 11 listeners
		// Each model has 2 instances that might listen
		this.setMaxListeners(Object.keys(models).length * 2 + 20)
		if (dbOptions.db)
			throw new TypeError(
				'db is no longer an option, pass the db options instead, e.g. file, verbose, readOnly'
			)
		if (!models) throw new TypeError('models are required')
		if (queueFile && queue)
			throw new TypeError('Either pass queue or queueFile')

		this.rwDb = new DB({
			...dbOptions,
			onWillOpen,
			onBeforeMigrations: async db => {
				const v = await db.userVersion()
				if (v) this.queue.setKnownV(v)
				if (prevOBM) await prevOBM()
			},
			onDidOpen,
		})
		const {readOnly} = this.rwDb

		// The RO DB needs to be the same for :memory: or it won't see anything
		this.db =
			this.rwDb.file === ':memory:' || readOnly
				? this.rwDb
				: new DB({
						...dbOptions,
						name: dbOptions.name && `RO-${dbOptions.name}`,
						readOnly: true,
						onWillOpen: async () => {
							// Make sure migrations happened before opening
							await this.rwDb.open()
						},
				  })

		if (queue) {
			this.queue = queue
		} else {
			const qDb = new DB({
				...dbOptions,
				name: `${dbOptions.name || ''}Queue`,
				file: queueFile || this.rwDb.file,
			})
			this.queue = new EventQueue({
				db: qDb,
				withViews,
				columns: {events: {type: 'JSON'}},
			})
		}
		const qDbFile = this.queue.db.file
		// If queue is in same file as rwDb, share the connection
		// for writing results during transaction - no deadlocks
		this._resultQueue =
			this.rwDb.file === qDbFile && qDbFile !== ':memory:'
				? new EventQueue({db: this.rwDb})
				: this.queue

		// Move old history data to queue DB
		if (this.rwDb.file !== qDbFile) {
			registerHistoryMigration(this.rwDb, this.queue)
		}
		this.rwDb.registerMigrations('ESDB', {
			// Move v2 metadata version to DB user_version
			userVersion: async db => {
				const uv = await db.userVersion()
				if (uv) return // Somehow we already have a version
				const hasMetadata = await db.get(
					'SELECT 1 FROM sqlite_master WHERE name="metadata"'
				)
				if (!hasMetadata) return
				const vObj = await db.get(
					'SELECT json_extract(json, "$.v") AS v FROM metadata WHERE id="version"'
				)
				const v = vObj && Number(vObj.v)
				if (!v) return
				await db.userVersion(v)
				const {count} = await db.get(`SELECT count(*) AS count from metadata`)
				if (count === 1) {
					await db
						.exec(
							`DROP TABLE metadata; DELETE FROM _migrations WHERE runKey="0 metadata"`
						)
						.catch(() => {
							/* shrug */
						})
				} else {
					await db.run(`DELETE FROM metadata WHERE id="version"`)
				}
			},
		})

		this.store = {}
		this.rwStore = {}
		this._alsDispatch = new AsyncLocalStorage()

		this._preprocModels = []
		this._reducerNames = []
		this._deriverModels = []
		this._transactModels = []
		this._readWriters = []
		const reducers = {}
		const migrationOptions = {queue: this.queue}

		const dispatch = async (type, data, ts) => {
			if (this._processing) {
				const dispatchSubEvent = this._alsDispatch.getStore()
				if (!dispatchSubEvent)
					throw new Error(`Dispatching is only allowed in transact phase`)
				return dispatchSubEvent(type, data)
			}
			return this.dispatch(type, data, ts)
		}

		for (const [name, modelDef] of Object.entries(models)) {
			try {
				if (!modelDef) throw new Error('model missing')
				let {
					reducer,
					preprocessor,
					deriver,
					transact,
					Model = ESModel,
					RWModel = Model,
					...rest
				} = modelDef

				if (RWModel === ESModel) {
					if (reducer) {
						const prev = fixupOldReducer(name, reducer)
						reducer = async args => {
							const result = await prev(args)
							if (!result && args.event.type === model.TYPE)
								return ESModel.reducer(args)
							return result
						}
					}
					if (preprocessor) {
						const prev = preprocessor
						preprocessor = async args => {
							const e = await ESModel.preprocessor(args)
							if (e) args.event = e
							return prev(args)
						}
					}
				}
				let hasOne = false

				const rwModel = this.rwDb.addModel(RWModel, {
					name,
					...rest,
					migrationOptions,
					dispatch,
					emitter: this,
				})
				rwModel.deriver = deriver || RWModel.deriver
				this.rwStore[name] = rwModel
				if (typeof rwModel.setWritable === 'function')
					this._readWriters.push(rwModel)
				if (rwModel.deriver) {
					this._deriverModels.push(rwModel)
					hasOne = true
				}

				let model
				if (this.db === this.rwDb) {
					model = rwModel
				} else {
					model = this.db.addModel(Model, {
						name,
						...rest,
						dispatch,
						emitter: this,
					})
				}
				model.preprocessor = preprocessor || Model.preprocessor
				model.reducer = fixupOldReducer(name, reducer || Model.reducer)
				if (!model.transact) model.transact = transact || Model.transact
				this.store[name] = model
				if (model.preprocessor) {
					this._preprocModels.push(model)
					hasOne = true
				}
				if (model.reducer) {
					this._reducerNames.push(name)
					reducers[name] = model.reducer
					hasOne = true
				}
				if (model.transact) {
					this._transactModels.push(model)
					hasOne = true
				}

				if (!hasOne)
					throw new TypeError(
						`${this.name}: At least one reducer, deriver or preprocessor required`
					)
			} catch (error) {
				if (error.message)
					error.message = `ESDB: while configuring model ${name}: ${error.message}`
				if (error.stack)
					error.stack = `ESDB: while configuring model ${name}: ${error.stack}`
				throw error
			}
		}
	}

	open() {
		return this.db.open()
	}

	async close() {
		await this.stopPolling()
		return Promise.all([
			this.rwDb && this.rwDb.close(),
			this.db !== this.rwDb && this.db.close(),
			this.queue.db.close(),
		])
	}

	async checkForEvents() {
		const [v, qV] = await Promise.all([this.getVersion(), this.queue.getMaxV()])
		if (v < qV) return this.startPolling(qV)
	}

	async waitForQueue() {
		// give migrations a chance to queue things
		await this.rwDb.open()
		const v = await this.queue.getMaxV()
		return this.handledVersion(v)
	}

	_waitingP = null

	_minVersion = 0

	startPolling(wantVersion) {
		if (wantVersion) {
			if (wantVersion > this._minVersion) this._minVersion = wantVersion
		} else if (!this._isPolling) {
			this._isPolling = true
			if (module.hot) {
				module.hot.dispose(() => {
					this.stopPolling()
				})
			}
		}
		if (!this._waitingP) {
			this._waitingP = this._waitForEvent()
				.catch(error => {
					// eslint-disable-next-line no-console
					console.error(
						'!!! Error waiting for event! This should not happen! Please investigate!',
						error
					)
					// Crash program but leave some time to notify
					if (process.env.NODE_ENV !== 'test')
						// eslint-disable-next-line unicorn/no-process-exit
						setTimeout(() => process.exit(100), 500)

					throw new Error(error)
				})
				.then(lastV => {
					this._waitingP = null
					// Subtle race condition: new wantVersion coming in between end of _wait and .then
					// lastV is falsy when forcing a stop
					if (lastV != null && this._minVersion && lastV < this._minVersion)
						return this.startPolling(this._minVersion)
					this._minVersion = 0
					return undefined
				})
		}
		return this._waitingP
	}

	stopPolling() {
		this._isPolling = false
		this._reallyStop = true
		this.queue.cancelNext()
		return this._waitingP || Promise.resolve()
	}

	/**
	 * @param {string|{type: string, data?: any, ts?: number}} type event type or the entire event
	 * @param {any} [data] event data, can be anything
	 * @param {number} [ts] the timestamp of the event
	 * @returns {Promise<Event>} the processed event
	 */
	async dispatch(type, data, ts) {
		if (type && typeof type === 'object') {
			if (DEV) {
				if (data)
					throw new Error(
						'dispatch: second argument must not be defined when passing the event as an object'
					)
				const {type: _1, data: _2, ts: _3, ...rest} = type
				if (Object.keys(rest).length)
					throw new Error(`dispatch: extra key(s) ${Object.keys(rest).join()}`)
			}
			data = type.data
			ts = type.ts
			type = type.type
		}
		if (!type || typeof type !== 'string')
			throw new Error('dispatch: type is a required string')
		const event = await this.queue.add(type, data, ts)
		return this.handledVersion(event.v)
	}

	// Dispatch handler for sub-events, used during transact phase
	_dispatchSubEvent = null

	_addSubEvent(event, type, data) {
		if (!event.events) event.events = []
		event.events.push({type, data})
		dbg(`${event.type}.${type} queued`)
	}

	_getVersionP = null

	getVersion() {
		if (!this._getVersionP) {
			this._getVersionP = this.db.userVersion().finally(() => {
				this._getVersionP = null
			})
		}
		return this._getVersionP
	}

	_waitingFor = {}

	_maxWaitingFor = 0

	async handledVersion(v) {
		if (!v) return
		// We must get the version first because our history might contain future events
		if (v <= (await this.getVersion())) {
			const event = await this.queue.get(v)
			// The event could be missing if pruned
			if (event?.error) {
				// This can only happen if we skipped a failed event
				return Promise.reject(event)
			}
			return event
		}
		if (!this._waitingFor[v]) {
			if (v > this._maxWaitingFor) this._maxWaitingFor = v
			const o = {}
			this._waitingFor[v] = o
			o.promise = new Promise((resolve, reject) => {
				o.resolve = resolve
				o.reject = reject
			})
			this.startPolling(v)
		}
		return this._waitingFor[v].promise
	}

	_triggerEventListeners(event) {
		const o = this._waitingFor[event.v]
		if (o) delete this._waitingFor[event.v]

		if (event.v >= this._maxWaitingFor) {
			// Normally this will be empty but we might encounter a race condition
			for (const vStr of Object.keys(this._waitingFor)) {
				const v = Number(vStr)
				if (v > event.v) continue
				// Note: if the DB fails for get(), the trigger won't run and it will retry later
				// eslint-disable-next-line promise/catch-or-return
				this.queue.get(v).then(event => this._triggerEventListeners(event))
			}
		}

		// Note that error events don't increase the DB version
		if (event.error) {
			// emit 'error' throws if there is no listener
			if (this.listenerCount('error')) {
				try {
					this.emit('error', event)
				} catch (error) {
					// eslint-disable-next-line no-console
					console.error('!!! "error" event handler threw, ignoring', error)
				}
			}
			if (o && process.env.NODE_ENV === 'test') {
				if (!this.__BE_QUIET)
					// eslint-disable-next-line no-console
					console.error(
						`!!! rejecting the dispatch for event ${event.v} ${event.type} - this does NOT happen outside test mode, NEVER rely on this.
						Set eSDB.__BE_QUIET to not show this message`
					)
				o.reject(event)
			}
		} else {
			try {
				this.emit('result', event)
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error('!!! "result" event handler threw, ignoring', error)
			}
			if (o) o.resolve(event)
		}
	}

	_processing = false

	// This is the loop that applies events from the queue. Use startPolling(false) to always poll
	// so that events from other processes are also handled
	// It would be nice to not have to poll, but sqlite triggers only work on
	// the connection that makes the change
	// This should never throw, handling errors can be done in apply
	_waitForEvent = async () => {
		/* eslint-disable no-await-in-loop */
		const {rwDb} = this
		let lastV = 0
		let errorCount = 0
		if (dbg.enabled && this._minVersion)
			dbg(`waiting for events until minVersion: ${this._minVersion}`)
		while (!this._minVersion || this._minVersion > lastV) {
			if (errorCount) {
				if (errorCount > this.MAX_RETRY)
					throw new Error(`Giving up on processing event ${lastV + 1}`)
				// These will reopen automatically
				await Promise.all([
					this.db.file !== ':memory:' && this.db.close(),
					this.rwDb.file !== ':memory:' && this.rwDb.close(),
					this.queue.db.file !== ':memory:' && this.queue.db.close(),
				])
				await wait(5000 * errorCount)
			}
			let event
			try {
				event = await this.queue.getNext(
					await this.getVersion(),
					!(this._isPolling || this._minVersion)
				)
			} catch (error) {
				errorCount++
				// eslint-disable-next-line no-console
				console.error(
					`!!! ESDB: queue.getNext failed - this should not happen`,
					error
				)
				continue
			}
			if (!event) return lastV

			const resultEvent = await rwDb
				.withTransaction(async () => {
					this._processing = true
					lastV = event.v

					// It could be that it was processed elsewhere due to racing
					const nowV = await this.getVersion()
					if (event.v <= nowV) return

					await rwDb.run('SAVEPOINT handle')
					const result = await this._handleEvent(event)
					if (result.error) {
						// Undo all changes, but retain the event info
						await rwDb.run('ROLLBACK TO SAVEPOINT handle')
						if (result.result) {
							result.failedResult = result.result
							delete result.result
						}
					} else {
						await rwDb.run('RELEASE SAVEPOINT handle')
					}
					return this._resultQueue.set(result)
				})
				.catch(error => {
					if (!this.__BE_QUIET)
						// eslint-disable-next-line no-console
						console.error(
							'!!! ESDB: an error occured outside of the normal error handlers',
							error
						)
					return {
						...event,
						error: {_SQLite: errorToString(error)},
					}
				})
				.finally(() => {
					this._processing = false
				})
			if (!resultEvent) continue // Another process handled the event

			if (resultEvent.error) {
				errorCount++
				if (!this.__BE_QUIET) {
					let path, error
					// find the deepest error
					const walkEvents = (ev, p = ev.type) => {
						if (ev.events) {
							let i = 0
							for (const sub of ev.events)
								if (walkEvents(sub, `${p}.${i++}:${sub.type}`)) return true
						}
						if (ev.error) {
							path = p
							error = ev.error
							return true
						}
						return false
					}
					walkEvents(resultEvent)
					// eslint-disable-next-line no-console
					console.error(
						`!!! ESDB: event ${path} processing failed (try #${errorCount})`,
						error
					)
				}
				lastV = resultEvent.v - 1
			} else errorCount = 0

			this._triggerEventListeners(resultEvent)

			if (this._reallyStop || (errorCount && process.env.NODE_ENV === 'test')) {
				this._reallyStop = false
				return
			}
		}
		return lastV
		/* eslint-enable no-await-in-loop */
	}

	async _preprocessor(cache, event, isMainEvent) {
		const addEvent = this._addSubEvent.bind(this, event)
		const dispatch = (...args) => {
			deprecated('addEvent preprocessor', 'use .addEvent instead of .dispatch')
			return addEvent(...args)
		}
		for (const model of this._preprocModels) {
			const {name} = model
			const {v, type} = event
			let newEvent
			try {
				// eslint-disable-next-line no-await-in-loop
				newEvent = await model.preprocessor({
					cache,
					event,
					// subevents must see intermediate state
					model: isMainEvent ? model : this.rwStore[name],
					store: isMainEvent ? this.store : this.rwStore,
					addEvent,
					dispatch,
					isMainEvent,
				})
			} catch (error) {
				newEvent = {error}
			}
			// mutation allowed
			if (!newEvent) newEvent = event
			if (!newEvent.error) {
				// Just in case event was mutated
				if (newEvent.v !== v)
					newEvent.error = new Error(`preprocessor must retain event version`)
				else if (!newEvent.type)
					newEvent.error = new Error(`preprocessor must retain event type`)
			}
			if (newEvent.error) {
				return {
					...event,
					v,
					type,
					error: {
						[`_preprocess_${name}`]: errorToString(newEvent.error),
					},
				}
			}
			// allow other preprocessors to alter the event
			event = newEvent
		}
		return event
	}

	async _reducer(cache, event, isMainEvent) {
		const result = {}

		if (DEV) {
			Object.freeze(event.data)
		}
		await Promise.all(
			this._reducerNames.map(async name => {
				const model = this.store[name]
				const addEvent = this._addSubEvent.bind(this, event)
				const dispatch = (...args) => {
					deprecated('addEvent', 'use .addEvent instead of .dispatch')
					return addEvent(...args)
				}
				const helpers = {
					cache,
					event,
					// subevents must see intermediate state
					model: isMainEvent ? model : this.rwStore[name],
					store: isMainEvent ? this.store : this.rwStore,
					dispatch,
					addEvent,
					isMainEvent,
				}
				let out
				try {
					out = await model.reducer(helpers)
				} catch (error) {
					out = {
						error: errorToString(error),
					}
				}
				// in <v3 we allowed returning the model to indicate no change
				if (!out || out === model) return
				if (out.events) {
					if (!Array.isArray(out.events)) {
						result[name] = {error: `.events is not an array`}
						return
					}
					// Note that reducers can add/alter event.events
					if (!event.events) event.events = []
					event.events.push(...out.events)
					delete out.events
				} else if ('events' in out) {
					// allow falsy events
					delete out.events
				}
				result[name] = out
			})
		)

		if (this._reducerNames.some(n => result[n] && result[n].error)) {
			const error = {}
			for (const name of this._reducerNames) {
				const r = result[name]
				if (r && r.error) {
					error[`_reduce_${name}`] = r.error
				}
			}
			return {...event, error}
		}

		const resultEvent = {
			...event,
			result,
		}
		return resultEvent
	}

	async _transact(event, isMainEvent, dispatch) {
		for (const model of this._transactModels) {
			const {name} = model
			const {v, type} = event
			try {
				// eslint-disable-next-line no-await-in-loop
				await model.transact({
					event,
					// subevents must see intermediate state
					model: isMainEvent ? model : this.rwStore[name],
					store: isMainEvent ? this.store : this.rwStore,
					dispatch,
					isMainEvent,
				})
			} catch (error) {
				return {
					...event,
					v,
					type,
					error: {
						[`_transact_${name}`]: errorToString(error),
					},
				}
			}
		}
		return event
	}

	async _handleEvent(origEvent, depth = 0) {
		const isMainEvent = depth === 0
		let event
		if (depth > 100) {
			return {
				...origEvent,
				error: {
					_handle: `.${origEvent.type}: events recursing too deep`,
				},
			}
		}
		dbg(`handling ${origEvent.v} ${'>'.repeat(depth)}${origEvent.type}`)
		event = {
			...origEvent,
			result: undefined,
			events: undefined,
			error: undefined,
		}
		let cache = {}
		event = await this._preprocessor(cache, event, isMainEvent)
		if (event.error) return event

		event = await this._reducer(cache, event, isMainEvent)
		if (event.error) return event

		// Allow GC
		cache = null

		event = await this._applyEvent(event, isMainEvent)
		if (event.error) return event

		// handle sub-events in order and allow adding in transact
		const events = event.events || []
		const handleSubEvent = async subEvent => {
			// We need to add and remove v so subEvents have v too
			const doneEvent = await this._handleEvent(
				{...subEvent, v: event.v},
				depth + 1
			)
			delete doneEvent.v
			// If an error occurs, signal via parent event error
			const {error} = doneEvent
			if (error) {
				// pass the error upwards but leave on bottom-most
				if (depth && error._handle) delete doneEvent.error
				event.error = {
					_handle: `.${subEvent.type}${
						error._handle ? error._handle : ` failed`
					}`,
				}
			}
			return doneEvent
		}

		for (let i = 0; i < events.length; i++) {
			// eslint-disable-next-line no-await-in-loop
			events[i] = await handleSubEvent(events[i])
			if (event.error) return event
		}

		// We need AsyncLocalStorage below to make sure models use the
		// correct dispatch in each subevent

		let lastP = null
		const dispatch = async (type, data) => {
			if (type && typeof type === 'object') {
				if (DEV) {
					if (data)
						throw new Error(
							'dispatch: second argument must not be defined when passing the event as an object'
						)
					// We allow ts in sub events but we ignore it
					const {type: _1, data: _2, ts: _3, ...rest} = type
					if (Object.keys(rest).length)
						throw new Error(
							`dispatch: extra key(s) ${Object.keys(rest).join()}`
						)
				}
				data = type.data
				type = type.type
			}
			if (!type || typeof type !== 'string')
				throw new Error('dispatch: type is a required string')
			const subEventP = this._alsDispatch.run(undefined, handleSubEvent, {
				type,
				data,
			})
			// Make sure we handle the dispatches in order
			if (lastP) lastP = lastP.then(subEventP)
			else lastP = subEventP
			const subEvent = await lastP
			events.push(subEvent)
			if (event.error)
				throw new Error(`Event ${event.v} errored: ${event.error._handle}`)
			return subEvent
		}
		event = await this._alsDispatch.run(dispatch, () =>
			this._transact(event, isMainEvent, dispatch)
		)
		if (events.length) event.events = events

		return event
	}

	async _applyEvent(event, isMainEvent) {
		const {rwStore, rwDb, _readWriters: readWriters} = this
		let phase = '???'
		try {
			for (const model of readWriters) model.setWritable(true)
			const {result} = event

			if (result && !isEmpty(result)) {
				phase = 'apply'
				// Apply reducer results, wait for all to settle
				await settleAll(
					Object.entries(result),
					async ([name, r]) => r && rwStore[name].applyResult(r)
				)
			}

			if (isMainEvent) {
				phase = 'version'
				await rwDb.userVersion(event.v)
			}

			// Apply derivers
			if (!event.error && this._deriverModels.length) {
				phase = 'derive'
				const addEvent = this._addSubEvent.bind(this, event)
				const dispatch = (...args) => {
					deprecated('addEvent deriver', 'use .addEvent instead of .dispatch')
					return addEvent(...args)
				}
				await settleAll(this._deriverModels, async model =>
					model.deriver({
						event,
						model,
						// derivers can write anywhere (carefully)
						store: this.rwStore,
						addEvent,
						dispatch,
						isMainEvent,
						result: result[model.name],
					})
				)
			}
		} catch (error) {
			if (event.result) {
				event.failedResult = event.result
				delete event.result
			}
			if (!event.error) event.error = {}
			event.error[`_apply_${phase}`] = errorToString(error)
		} finally {
			for (const model of readWriters) model.setWritable(false)
		}

		return event
	}
}

export default EventSourcingDB
