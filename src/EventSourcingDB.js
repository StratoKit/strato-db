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

import JsonModel from './JsonModel'
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

class ESDB extends EventEmitter {
	store = {}

	constructor({db, queue, models}) {
		super()
		if (!db || !models) {
			throw new Error('db and models are required')
		}
		if (models.history || models.metadata) {
			throw new Error('history and metadata are reserved model names')
		}
		this.db = db
		this.queue = queue || new EventQueue({db})
		const sameDb = this.queue.db === db
		if (!sameDb) {
			// Give the queue db a chance to already start up
			// that way, our migrations aren't in hold state
			// maybe we need a startDb function instead
			queue.searchOne()
		}
		this.history = sameDb ? this.queue : new EventQueue({db})
		this._waitingFor = {}

		this.models = {
			...models,
			metadata,
		}

		this.modelNames = Object.keys(this.models)
		this.reducerNames = []
		this.deriverNames = []
		this.preprocNames = []
		const reducers = {}
		this.reducerModels = {}
		const migrationOptions = {queue}
		for (const name of this.modelNames) {
			const {
				Model,
				columns,
				migrations,
				reducer,
				deriver,
				preprocessor,
			} = this.models[name]
			this.store[name] = Model
				? db.addModel(Model, {name, migrationOptions})
				: db.addModel(JsonModel, {name, columns, migrations, migrationOptions})
			if (reducer) {
				this.reducerNames.push(name)
				this.reducerModels[name] = this.store[name]
				reducers[name] = reducer
			}
			if (deriver) {
				this.deriverNames.push(name)
			}
			if (preprocessor) {
				this.preprocNames.push(name)
			}
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
		this.checkForEvents()
		return this.handledVersion(event.v)
	}

	async preprocessor(event) {
		for (const name of this.preprocNames) {
			const {store} = this
			const model = store[name]
			const {v, type} = event
			// eslint-disable-next-line no-await-in-loop
			const newEvent = await this.models[name].preprocessor({
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
			return {
				...event,
				result: {metadata},
			}
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
			return {
				...event,
				result: {metadata: result.metadata},
				error,
			}
		}
		for (const name of this.reducerNames) {
			const r = result[name]
			if (r === this.store[name]) {
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
		this.checkForEvents()
		return this.handledVersion(v)
	}

	async handledVersion(v) {
		if (v < (await this.getVersion())) {
			const event = await this.history.get(v)
			if (event.error) {
				return Promise.reject(event)
			}
			return event
		}
		// TODO this might race, applyer should also resolve earlier promises
		// maybe have a single promise for next event resolved and fetch from history if your event was earlier
		if (!this._waitingFor[v]) {
			const o = {}
			this._waitingFor[v] = o
			// eslint-disable-next-line promise/avoid-new
			o.promise = new Promise((resolve, reject) => {
				o.resolve = resolve
				o.reject = reject
			})
		}
		return this._waitingFor[v].promise
	}

	// This is the loop that applies events from the queue. Use startPolling(false) to always poll
	// so that events from other processes are also handled
	// It would be nice to not have to poll, but sqlite triggers only work on the connection
	// that makes the change
	// This should never throw, handling errors can be done in apply
	_waitForEvent = async () => {
		/* eslint-disable no-await-in-loop */
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const event = await this.queue.getNext(
				await this.getVersion(),
				!this._isPolling
			)
			if (!event) return
			if (!this._reduxInited) {
				await this.redux.didInitialize
				this._reduxInited = true
			}
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
			if (this._applyingP) {
				// This promise should always be there because the listeners are called
				// synchronously after the dispatch
				// We have to wait until the write applied before the next dispatch
				// Will never error
				await this._applyingP
			}
			if (this._reallyStop) {
				this._reallyStop = false
				return
			}
		}
		/* eslint-enable no-await-in-loop */
	}

	checkForEvents() {
		this.startPolling(true)
	}

	_waitingP = null

	startPolling(once) {
		if (!once && !this._isPolling) {
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
				})
				// eslint-disable-next-line promise/always-return
				.then(() => {
					this._waitingP = null
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
		const o = this._waitingFor[event.v]
		if (o) {
			delete this._waitingFor[event.v]
			if (event.error) {
				o.reject(event)
			} else {
				o.resolve(event)
			}
		}
	}

	async applyEvent(event, _quietImTesting) {
		const {db, store, modelNames, history} = this
		// All the below must be started synchronously so
		// no other requests on this db connection come between
		// NOTE: due to sqlite and js serializing, the BEGIN transaction
		// will run first even though it's a bunch of promises
		// if not using sqlite, be careful
		return db
			.withTransaction(() => {
				const promises = []
				for (const name of modelNames) {
					const r = event.result[name]
					if (r) promises.push(store[name].applyChanges(r))
				}
				promises.push(history.set(event))
				return Promise.all(promises).then(() =>
					Promise.all(
						this.deriverNames.map(name => {
							const {store} = this
							const model = store[name]
							return this.models[name].deriver({
								model,
								store,
								event,
								result: event.result,
							})
						})
					)
				)
			})
			.catch(err => {
				if (!_quietImTesting) {
					// argh, now what? Probably retry applying, or crash the app…
					// This can happen when DB has issue, or when .set refuses an object
					// TODO consider latter case, maybe just consider transaction errored and store as error?
					console.error(
						`
						-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
						-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
						SEVERE DB ERROR
					`,
						err,
						`
						-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
						-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
					`
					)
				}
				// eslint-disable-next-line promise/no-nesting
				throw err
			})
	}
}

export default ESDB
