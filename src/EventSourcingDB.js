/* eslint-disable no-console */
// Event Sourcing DataBase
// * Only allows changes via messages that are stored and processed. This allows easy
//   replication, debugging and possibly even rollback
// * All the database tables participating should only be changed via events. There is a version entry
//   in the metadata table that shows what event version the db is at.
// * Events describe facts that happened
//   * Think of them as newspaper clippings (that changed) or notes passed to the kitchen (this change requested)
// * Models store the data in a table an define preprocessor, reducer, applyEvent and deriver
//   * TODO rename applyEvent -> applyResult
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

import debug from 'debug'
import {isEmpty} from 'lodash'
import DB from './DB'
import ESModel from './ESModel'
import {createStore, combineReducers} from './async-redux'
import EventQueue from './EventQueue'
import EventEmitter from 'events'

const dbg = debug('stratokit/ESDB')

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
				console.error(`!!! history table in ${rwDb.file} is no longer needed`)
			},
		},
	})
}

const screenLine = '\n!!! -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=\n'
const showHugeDbError = (err, where) => {
	if (process.env.NODE_ENV !== 'test') {
		console.error(
			`${screenLine}!!! SEVERE ERROR in ${where} !!!${screenLine}`,
			err,
			screenLine
		)
	}
}

class ESDB extends EventEmitter {
	// eslint-disable-next-line complexity
	constructor({queue, models, queueFile, withViews = true, ...dbOptions}) {
		super()
		if (dbOptions.db)
			throw new TypeError(
				'db is no longer an option, pass the db options instead, e.g. file, verbose, readOnly'
			)
		if (!models) throw new TypeError('models are required')
		if (queueFile && queue)
			throw new TypeError('Either pass  queue or queueFile')

		models = {metadata: {}, ...models}

		this.rwDb = new DB(dbOptions)
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
							await this.queue.db.openDB()
							await this.rwDb.openDB()
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
			this.queue = new EventQueue({db: qDb, withViews})
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

		this.store = {}
		this.rwStore = {}

		this.reducerNames = []
		this.deriverModels = []
		this.preprocModels = []
		this.readWriters = []
		const reducers = {}
		this.reducerModels = {}
		const migrationOptions = {queue: this.queue}

		const dispatch = this.dispatch.bind(this)
		for (const [name, modelDef] of Object.entries(models)) {
			try {
				if (!modelDef) throw new Error('model missing')
				let {
					reducer,
					preprocessor,
					deriver,
					Model = ESModel,
					RWModel = Model,
					...rest
				} = modelDef

				if (RWModel === ESModel) {
					if (reducer) {
						const prev = reducer
						reducer = async (model, event) => {
							const result = await prev(model, event)
							if (!result && event.type === model.TYPE)
								return ESModel.reducer(model, event)
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
				})
				rwModel.deriver = deriver || RWModel.deriver
				this.rwStore[name] = rwModel
				if (typeof rwModel.setWritable === 'function')
					this.readWriters.push(rwModel)
				if (rwModel.deriver) {
					this.deriverModels.push(rwModel)
					hasOne = true
				}

				let model
				if (this.db === this.rwDb) {
					model = rwModel
				} else {
					model = this.db.addModel(Model, {name, ...rest, dispatch})
				}
				model.preprocessor = preprocessor || Model.preprocessor
				model.reducer = reducer || Model.reducer
				this.store[name] = model
				if (model.preprocessor) {
					this.preprocModels.push(model)
					hasOne = true
				}
				if (model.reducer) {
					this.reducerNames.push(name)
					this.reducerModels[name] = model
					reducers[name] = model.reducer
					hasOne = true
				}

				if (!hasOne)
					throw new TypeError(
						`${
							this.name
						}: At least one reducer, deriver or preprocessor required`
					)
			} catch (error) {
				// TODO write test
				if (error.message)
					error.message = `ESDB: while configuring model ${name}: ${
						error.message
					}`
				throw error
			}
		}

		if (!readOnly) {
			this.modelReducer = combineReducers(reducers, true)
			this.redux = createStore(
				this.reducer.bind(this),
				undefined,
				undefined,
				true
			)
			this.redux.subscribe(this.handleResult)
			this.checkForEvents()
		}
	}

	close() {
		return Promise.all([
			this.rwDb && this.rwDb.close(),
			this.db !== this.rwDb && this.db.close(),
		])
	}

	async dispatch(type, data, ts) {
		const event = await this.queue.add(type, data, ts)
		return this.handledVersion(event.v)
	}

	async preprocessor(event) {
		for (const model of this.preprocModels) {
			const {name} = model
			const {store} = this
			const {v, type} = event
			let newEvent
			try {
				// eslint-disable-next-line no-await-in-loop
				newEvent = await model.preprocessor({
					event,
					model,
					store,
				})
			} catch (error) {
				newEvent = {error}
			}
			// mutation allowed
			if (!newEvent) newEvent = event
			if (newEvent.error) {
				return {
					...event,
					v,
					type,
					error: {[name]: newEvent.error},
				}
			}
			if (newEvent.v !== v) {
				// Just in case event was mutated
				// Be sure to put the version back or we put the wrong v in history
				return {
					...event,
					v,
					type,
					error: {
						_preprocess: {
							message: `${name}: preprocessor must retain event version`,
						},
					},
				}
			}
			if (!newEvent.type) {
				return {
					...event,
					v,
					type,
					error: {
						_preprocess: {
							message: `${name}: preprocessor must return event type`,
						},
					},
				}
			}
			event = newEvent
		}
		return event
	}

	async reducer(state, event) {
		if (!event.v) return false
		event = await this.preprocessor(event)
		if (event.error) return event
		const result = await this.modelReducer(this.reducerModels, event)
		if (this.reducerNames.some(n => result[n].error)) {
			const error = {}
			for (const name of this.reducerNames) {
				const r = result[name]
				if (r.error) {
					error[name] = r.error
				}
			}
			return {...event, error}
		}
		for (const name of this.reducerNames) {
			const r = result[name]
			if (r === false || r === this.store[name]) {
				// no change
				delete result[name]
			}
		}
		return {
			...event,
			result,
		}
	}

	getVersionP = null

	getVersion() {
		if (!this.getVersionP) {
			this.getVersionP = this.store.metadata.get('version').then(vObj => {
				this.getVersionP = null
				return vObj ? vObj.v : 0
			})
		}
		return this.getVersionP
	}

	async waitForQueue() {
		const v = await this.queue._getLatestVersion()
		return this.handledVersion(v)
	}

	_waitingFor = {}

	_maxWaitingFor = 0

	async handledVersion(v) {
		if (v === 0) return
		// We must get the version first because our history might contain future events
		if (v <= (await this.getVersion())) {
			const event = await this.queue.get(v)
			if (event.error) {
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

	triggerWaitingEvent(event) {
		const o = this._waitingFor[event.v]
		if (o) {
			delete this._waitingFor[event.v]
			if (event.error) {
				o.reject(event)
			} else {
				o.resolve(event)
			}
		}
		if (event.v >= this._maxWaitingFor) {
			// Normally this will be empty but we might encounter a race condition
			for (const [v, o] of Object.entries(this._waitingFor)) {
				// eslint-disable-next-line promise/catch-or-return
				this.queue.get(v).then(event => {
					if (event.error) {
						o.reject(event)
					} else {
						o.resolve(event)
					}
					return undefined
				}, o.reject)
				delete this._waitingFor[v]
			}
		}
	}

	// This is the loop that applies events from the queue. Use startPolling(false) to always poll
	// so that events from other processes are also handled
	// It would be nice to not have to poll, but sqlite triggers only work on the connection
	// that makes the change
	// This should never throw, handling errors can be done in apply
	_waitForEvent = async () => {
		/* eslint-disable no-await-in-loop */
		let lastV = 0
		dbg(`waiting for events until minVersion: ${this._minVersion}`)
		while (!this._minVersion || this._minVersion > lastV) {
			const event = await this.queue.getNext(
				await this.getVersion(),
				!(this._isPolling || this._minVersion)
			)
			if (!event) return lastV
			// Clear previous result/error, if any
			delete event.error
			delete event.result
			lastV = event.v
			// It could be that it was processed elsewhere due to racing
			const nowV = await this.getVersion()
			if (event.v <= nowV) {
				dbg(`skipping ${event.v} because we're at ${nowV}`)
				continue
			}
			if (!this._reduxInited) {
				await this.redux.didInitialize
				this._reduxInited = true
			}
			const doneEvent = await this.rwDb.withTransaction(async () => {
				try {
					// TODO just wait for the dispatch
					// and call apply directly, not via redux
					await this.redux.dispatch(event)
				} catch (error) {
					// Do not await this, deadlock
					// This will never error, safe to call here
					this.handleResult({
						...event,
						error: {
							...event.error,
							_redux: {message: error.message, stack: error.stack},
						},
					})
				}
				// This promise should always be there because the listeners are called
				// synchronously after the dispatch
				// We have to wait until the write applied before the next dispatch
				// Will never error
				return this._applyingP
			})
			this.triggerWaitingEvent(doneEvent)
			if (this._reallyStop) {
				this._reallyStop = false
				return
			}
		}
		return lastV
		/* eslint-enable no-await-in-loop */
	}

	checkForEvents() {
		this.startPolling(1)
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
					console.error(
						'!!! Error waiting for event! This should not happen! Please investigate!',
						error
					)
					// Crash program but leave some time to notify
					// eslint-disable-next-line unicorn/no-process-exit
					setTimeout(() => process.exit(100), 50)

					throw new Error(error)
				})
				.then(lastV => {
					this._waitingP = null
					// Subtle race condition: new wantVersion coming in between end of _wait and .then
					if (this._minVersion && lastV < this._minVersion)
						return this.startPolling(this._minVersion)
					this._minVersion = 0
					return undefined
				})
		}
		return this._waitingP
	}

	stopPolling() {
		this._isPolling = false
		// here we should cancel the getNext
		this._reallyStop = true
		return this._waitingP || Promise.resolve()
	}

	_applyingP = null

	handleResult = async event => {
		if (!event) event = this.redux.getState()
		if (!event.v) {
			return
		}
		this._applyingP = this.applyEvent(event).catch(error => {
			console.error(
				'!!! Error while applying event; changes not applied',
				error
			)
		})
		await this._applyingP
		this._applyingP = null
		if (event.error) {
			// this throws if there is no listener
			if (this.listenerCount('error')) {
				try {
					this.emit('error', event)
				} catch (error) {
					console.error('!!! "error" event handler threw, ignoring', error)
				}
			}
		} else {
			try {
				this.emit('result', event)
			} catch (error) {
				console.error('!!! "result" event handler threw, ignoring', error)
			}
		}
		try {
			this.emit('handled', event)
		} catch (error) {
			console.error('!!! "handled" event handler threw, ignoring', error)
		}
	}

	async applyEvent(event) {
		const {rwStore, rwDb, readWriters} = this
		for (const model of readWriters) model.setWritable(true)
		try {
			const {v, result} = event
			const currVDoc = await rwDb.get(
				`SELECT json_extract(json,'$.v') AS v FROM metadata WHERE id='version'`
			)
			const currV = currVDoc && currVDoc.v
			if (currV && v <= currV) {
				event.error = {
					...event.error,
					_apply: `Current version ${currV} is >= event version ${v}`,
				}
				event.failedResult = event.result
				delete event.result
			} else {
				if (result && !isEmpty(result)) {
					// Apply reducer results
					try {
						await rwDb.run('SAVEPOINT apply')
						await Promise.all(
							Object.entries(result).map(
								([name, r]) => r && rwStore[name].applyChanges(r)
							)
						)
						await rwDb.run('RELEASE SAVEPOINT apply')
					} catch (error) {
						showHugeDbError(error, 'apply')
						await rwDb.run('ROLLBACK TO SAVEPOINT apply')
						event.failedResult = event.result
						delete event.result
						event.error = {_apply: error.message || error}
					}
				}
				// Even if the apply failed we'll consider this event handled
				await rwDb.run(
					`INSERT OR REPLACE INTO metadata(id,json) VALUES ('version','{"v":${v}}')`
				)
			}

			await this._resultQueue.set(event)

			// Apply derivers
			if (!event.error && this.deriverModels.length) {
				try {
					// TODO probably don't use this but roll back to apply
					await rwDb.run('SAVEPOINT derive')
					await Promise.all(
						this.deriverModels.map(model =>
							model.deriver({
								model,
								// TODO would this not better be the RO store?
								store: this.rwStore,
								event,
								result,
							})
						)
					)
					await rwDb.run('RELEASE SAVEPOINT derive')
				} catch (error) {
					showHugeDbError(error, 'derive')
					await rwDb.run('ROLLBACK TO SAVEPOINT derive')
					event.failedResult = event.result
					delete event.result
					event.error = {_derive: error.message || error}
					// TODO _resultQueue?
					await this.queue.set(event)
				}
			}
		} catch (error) {
			// argh, now what? Probably retry applying, or crash the app…
			// This can happen when DB has issue
			showHugeDbError(error, 'handleResult')

			throw error
		} finally {
			for (const model of readWriters) model.setWritable(false)
		}

		return event
	}
}

export default ESDB
