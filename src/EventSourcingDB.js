/* eslint-disable no-console */
// Event Sourcing DataBase
// * Events describe facts that happened in the outside world and have to be stored
// * Events have version v, strictly ordered
// * Each event is handled separately and serially.
// * Each table is maintained by a reducer
// * Reducers get the table at v-1 and the event, and describe the change for version v
// * Once all reducers ran, the changes are applied and the db is at version v
// * To make changes to a table, change the reducer and rebuild the DB, or migrate the table

// TODO implement this.stopPolling - currently incomplete
// TODO use query_only pragma between writes
// TODO promises for each deriver so they can depend on each other
// TODO decide if we keep .store or instead use .db.models
// TODO test for multi-process - especially store listeners should get (all missed?) events
// IDEA eventually allow multiple ESDBs by storing version per queue name
// TODO think about transient event errors vs event errors - if transient, event should be retried, no?
// TODO jsonmodel that includes auto-caching between events, use pragma data_version to know when data changed

import ESModel from './ESModel'
import {createStore, combineReducers} from './async-redux'
import EventQueue from './EventQueue'
import EventEmitter from 'events'

const metadata = {
	reducer: async (model, {v = 0}) => {
		if (!model) {
			return {}
		}
		const currVDoc = await model.get('version')
		const currV = currVDoc ? currVDoc.v : -1
		if (v > currV) {
			return {set: [{id: 'version', v}]}
		}
		return {
			error: {
				message: `Current version ${currV} is >= event version ${v}`,
			},
		}
	},
}

const showHugeDbError = (err, where) => {
	if (process.env.NODE_ENV !== 'test') {
		console.error(
			`
-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
!!! SEVERE ERROR in ${where} !!!
-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
		`,
			err,
			`
-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
		`
		)
	}
}

class ESDB extends EventEmitter {
	store = {}

	// eslint-disable-next-line complexity
	constructor({db, queue, models}) {
		super()
		if (!db || !models) {
			throw new Error('db and models are required')
		}
		if (models.metadata) {
			throw new Error('metadata is a reserved model name')
		}
		this.db = db
		this.queue = queue || new EventQueue({db})
		const sameDb = this.queue.db === db
		if (!sameDb) {
			// Give the queue db a chance to already start up
			// that way, our migrations aren't in hold state
			// maybe we need a startDb function instead
			queue.get(0)
		}

		this.models = {
			...models,
			metadata,
		}

		this.modelNames = Object.keys(this.models)
		this.reducerNames = []
		this.deriverNames = []
		this.preprocNames = []
		this.readWriters = []
		const reducers = {}
		this.reducerModels = {}
		const migrationOptions = {queue}
		if (!sameDb) {
			db.registerMigrations('historyExport', {
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
					},
				},
			})
		}
		const dispatch = this.dispatch.bind(this)
		for (const name of this.modelNames) {
			const {
				Model = ESModel,
				columns,
				migrations,
				reducer,
				deriver,
				preprocessor,
			} = this.models[name]

			const model = db.addModel(Model, {
				name,
				columns,
				migrations,
				migrationOptions,
				dispatch,
			})
			model.reducer = reducer || Model.reducer
			model.deriver = deriver || Model.deriver
			model.preprocessor = preprocessor || Model.preprocessor
			if (typeof model.setWriteable === 'function') this.readWriters.push(model)
			this.store[name] = model

			let hasOne = false
			if (model.reducer) {
				this.reducerNames.push(name)
				this.reducerModels[name] = this.store[name]
				reducers[name] = reducer || Model.reducer
				hasOne = true
			}
			if (model.deriver) {
				this.deriverNames.push(name)
				hasOne = true
			}
			if (model.preprocessor) {
				this.preprocNames.push(name)
				hasOne = true
			}
			if (!hasOne)
				throw new TypeError(
					`${this.name}: At least one reducer, deriver or preprocessor required`
				)
		}
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

	async dispatch(type, data, ts) {
		const event = await this.queue.add(type, data, ts)
		return this.handledVersion(event.v)
	}

	async preprocessor(event) {
		for (const name of this.preprocNames) {
			const {store} = this
			const model = store[name]
			const {v, type} = event
			const modelPreprocessor = this.models[name].preprocessor
			// eslint-disable-next-line no-await-in-loop
			const newEvent = await modelPreprocessor({
				event,
				model,
				store,
			})
			if (newEvent) {
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
		}
		return event
	}

	async reducer(state, event) {
		event = await this.preprocessor(event)
		if (event.error) {
			// preprocess failed, we need to apply metadata and store
			const metadata = await this.models.metadata.reducer(
				this.store.metadata,
				event
			)
			return {...event, result: {metadata}}
		}
		const result = await this.modelReducer(this.reducerModels, event)
		const hasError = this.reducerNames.some(n => result[n].error)
		if (hasError) {
			const error = {}
			for (const name of this.reducerNames) {
				const r = result[name]
				if (r.error) {
					error[name] = r.error
				}
			}
			return {...event, result: {metadata: result.metadata}, error}
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
			// eslint-disable-next-line promise/avoid-new
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
		// eslint-disable-next-line no-unmodified-loop-condition
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
			if (!this._reduxInited) {
				await this.redux.didInitialize
				this._reduxInited = true
			}
			await this.db.withTransaction(async () => {
				try {
					await this.redux.dispatch(event)
				} catch (err) {
					// Redux failed so we'll apply manually - TODO factor out
					const metadata = await this.models.metadata.reducer(
						this.store.metadata,
						event
					)
					// Will never error
					await this.handleResult({
						...event,
						error: {
							...event.error,
							_redux: {message: err.message, stack: err.stack},
						},
						result: {metadata},
					})
				}
				// This promise should always be there because the listeners are called
				// synchronously after the dispatch
				// We have to wait until the write applied before the next dispatch
				// Will never error
				return this._applyingP
			})
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
				.catch(err => {
					console.error(
						'!!! Error waiting for event! This should not happen! Please investigate!',
						err
					)
					return 0
				})
				.then(() => {
					this._waitingP = null
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
		this._applyingP = this.applyEvent(event).catch(err => {
			console.error('!!! Error while applying event; changes not applied', err)
		})
		await this._applyingP
		this._applyingP = null
		if (event.error) {
			// this throws if there is no listener
			if (this.listenerCount('error')) this.emit('error', event)
		} else {
			this.emit('result', event)
		}
		this.emit('handled', event)
		this.triggerWaitingEvent(event)
	}

	async applyEvent(event) {
		const {store, queue, readWriters} = this
		for (const model of readWriters) model.setWriteable(true)
		try {
			// First write our result to the queue (strip metadata, it's only v)
			const {result} = event
			const {metadata} = result
			delete result.metadata

			// Apply reducer results
			try {
				await this.db.run('SAVEPOINT apply')
				await Promise.all(
					Object.entries(result).map(
						([name, r]) => r && store[name].applyChanges(r)
					)
				)
				await this.db.run('RELEASE SAVEPOINT apply')
			} catch (err) {
				showHugeDbError(err, 'apply')
				await this.db.run('ROLLBACK TO SAVEPOINT apply')
				event.failedResult = event.result
				delete event.result
				event.error = {_apply: err.message || err}
			}

			// Even if the apply failed we'll consider this event handled
			// TODO maybe we should just halt instead
			await store.metadata.applyChanges(metadata)

			await queue.set(event)
			if (event.error) return

			// Apply derivers
			try {
				await this.db.run('SAVEPOINT derive')
				await Promise.all(
					this.deriverNames.map(name => {
						const modelDeriver = this.models[name].deriver
						return modelDeriver({
							model: store[name],
							store,
							event,
							result,
						})
					})
				)
				await this.db.run('RELEASE SAVEPOINT derive')
			} catch (err) {
				showHugeDbError(err, 'derive')
				await this.db.run('ROLLBACK TO SAVEPOINT derive')
				event.failedResult = event.result
				delete event.result
				event.error = {_derive: err.message || err}
				await queue.set(event)
			}
		} catch (err) {
			// argh, now what? Probably retry applying, or crash the app…
			// This can happen when DB has issue
			showHugeDbError(err, 'handleResult')

			throw err
		}

		for (const model of readWriters) model.setWriteable(false)
	}
}

export default ESDB
