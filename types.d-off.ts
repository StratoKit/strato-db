declare module 'strato-db' {
	type EET = NodeJS.EventEmitter
	class EventEmitter implements EET {}

	/** A callback receiving an item */
	type ItemCallback<Item> = (obj: Item) => Promise<void>

	/** The value of the stored objects' id */
	type JMIDValue = string | number

	export type ReduxArgs<M extends ESDBModel> = {
		cache: {}
		model: M
		event: ESEvent
		store: EventSourcingDB['store']
		addEvent: AddEventFn
		isMainEvent: boolean
	}
	export type DeriverArgs<M extends ESDBModel> = ReduxArgs<M> & {
		result: {[modelName: string]: ReduceResult}
	}
	export type PreprocessorFn<M extends ESDBModel = ESModel<JMObject>> = (
		args: ReduxArgs<M>
	) => Promise<ESEvent | null | undefined> | ESEvent | null | undefined
	export type ReducerFn<M extends ESDBModel = ESModel<JMObject>> = (
		args: ReduxArgs<M>
	) =>
		| Promise<ReduceResult | null | undefined | false>
		| ReduceResult
		| null
		| undefined
		| false
	export type ApplyResultFn = (result: ReduceResult) => Promise<void>
	export type DeriverFn<M extends ESDBModel = ESModel<JMObject>> = (
		args: DeriverArgs<M>
	) => Promise<void>

	type DispatchFn = (type: string, data?: any, ts?: number) => Promise<ESEvent>
	type AddEventFn = (type: string, data?: any) => void

	type ESDBModelArgs = {
		name: string
		db: DB
		dispatch: DispatchFn
		migrationOptions: Record<string, any> & {queue: EventQueue}
		emitter: EventEmitter
	}
	export abstract class ESDBModel {
		constructor(args: ESDBModelArgs)
		name: string
		/**
		 * Assigns the object id to the event at the start of the cycle.
		 * When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)
		 */
		preprocessor?: PreprocessorFn<this>
		/**
		 * Calculates the desired change.
		 * ESModel will only emit `rm`, `ins`, `upd` and `esFail`.
		 */
		reducer?: ReducerFn<this>
		/**
		 * Applies the result from the reducer.
		 *
		 * @param result  - free-form change descriptor.
		 * @returns - Promise for completion.
		 */
		applyResult?: ApplyResultFn
		deriver?: DeriverFn<this>
	}

	type ESDBOptions = DBOptions & {
		models: {[name: string]: ESDBModel}
		queue?: InstanceType<EventQueue>
		queueFile?: string
		withViews?: boolean
		onWillOpen?: DBCallback
		onBeforeMigrations?: DBCallback
		onDidOpen?: DBCallback
	}
	type ESDBStore = Record<string, ESDBModel>
	export class EventSourcingDB<
		Store extends ESDBStore = ESDBStore
	> extends EventEmitter {
		constructor(options: ESDBOptions)

		/** The read-only models. Use these freely, they don't "see" transactions */
		store: Store
		/** The writable models. Do not use. */
		rwStore: Store
		/** DB instance for the read-only models */
		db: DB
		/** DB instance for the writable models */
		rwDb: DB
		/** Queue instance holding the events */
		queue: EventQueue

		/** Open the DBs */
		open(): Promise<void>

		/** Close the DBs */
		close(): Promise<void>

		checkForEvents(): Promise<void>

		waitForQueue(): Promise<void>

		startPolling(wantVersion?: number): Promise<void>

		stopPolling(): Promise<void>

		dispatch(type: string, data?: any, ts?: number): Promise<ESEvent>

		getVersion(): Promise<number>

		handledVersion(v: number): Promise<void>
	}

	type EMOptions<
		M extends JsonModel<T, C, I>,
		T extends JMObject<I, IT>,
		C,
		I extends string,
		IT
	> = JMOptions<M, T, C, I, IT> & {
		/** the ESDB dispatch function */
		dispatch: DispatchFn
		/** emit an event with type `es/INIT:${modelname}` at table creation time, to be used by custom reducers.*/
		init?: boolean
	}
	/**
	 * ESModel is a drop-in wrapper around JsonModel to turn changes into events.
	 *
	 * Use it to convert your database to be event sourcing.
	 *
	 * Event data is encoded as an array: `[subtype, id, data, meta]`
	 * Subtype is one of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`.
	 * `id` is filled in by the preprocessor at the time of the event.
	 * `meta` is free-form data about the event. It is just stored in the history
	 * table.
	 *
	 * For example: `model.set({foo: true})` would result in the event `[1, 1, {foo:
	 * true}]`
	 * Pass the type of the item it stores and the config so it can determine the columns
	 */
	export class ESModel<
			RealItem extends JMObject<IDCol, IDType>,
			Config extends StrRecord & {idCol?: string} = {},
			IDCol extends string = Config extends {idCol: string}
				? Config['idCol']
				: 'id',
			IDType = RealItem[IDCol],
			EMItem = WithId<RealItem, IDCol>,
			InputItem = Partial<Omit<RealItem, IDCol>> & {[id in IDCol]-?: IDType}
		>
		extends JsonModel<RealItem, Config, IDCol, EMItem, InputItem>
		implements ESDBModel
	{
		constructor(
			options: EMOptions<
				JsonModel<RealItem, Config, IDCol>,
				RealItem,
				Config,
				IDCol,
				IDType
			>
		)
		static REMOVE: 0
		static SET: 1
		static INSERT: 2
		static UPDATE: 3
		static SAVE: 4
		static TYPE: string
		static INIT: string

		preprocessor(
			args: ReduxArgs<this>
		): Promise<ESEvent | null | undefined> | ESEvent | null | undefined
		reducer: ReducerFn<this>
		applyResult: ApplyResultFn

		dispatch: DispatchFn
		/**
		 * Slight hack: use the writable state to fall back to JsonModel behavior.
		 * This makes deriver and migrations work without changes.
		 * Note: while writable, no events are created. Be careful.
		 *
		 * @param state  - writeable or not.
		 */
		setWritable(state: boolean): void
		/**
		 * Insert or replace the given object into the database.
		 *
		 * @param obj           - the object to store. If there is no `id` value
		 *                      (or whatever the `id` column is named), one is
		 *                      assigned automatically.
		 * @param [insertOnly]  - don't allow replacing existing objects.
		 * @param [noReturn]    - do not return the stored object; an optimization.
		 * @param [meta]        - extra metadata to store in the event but not in
		 *                      the object.
		 * @returns - if `noReturn` is false, the stored object is fetched from the
		 *          DB.
		 */
		set(
			obj: Partial<EMItem>,
			insertOnly?: boolean,
			noReturn?: boolean,
			meta?: any
		): Promise<EMItem>
		/**
		 * Update an existing object. Returns the current object.
		 *
		 * @param o           - the data to store.
		 * @param [upsert]    - if `true`, allow inserting if the object doesn't
		 *                    exist.
		 * @param [noReturn]  - do not return the stored object; an optimization.
		 * @param [meta]      - extra metadata to store in the event at `data[3]`
		 *                    but not in the object.
		 * @returns - if `noReturn` is false, the stored object is fetched from the
		 *          DB.
		 */
		update(
			o: EMItem,
			upsert?: boolean,
			noReturn?: boolean,
			meta?: any
		): Promise<EMItem>
		/**
		 * Remove an object.
		 *
		 * @param idOrObj  - the id or the object itself.
		 * @param meta     - metadata, attached to the event only, at `data[3]`.
		 */
		remove(idOrObj: EMItem | JMIDValue, meta?: any): Promise<void>
		/**
		 * changeId: not implemented yet, had no need so far
		 */
		changeId(): Promise<void>
		/**
		 * Returns the next available integer ID for the model.
		 * Calling this multiple times during a redux cycle will give increasing
		 * numbers even though the database table doesn't change.
		 * Use this from the redux functions to assign unique ids to new objects.
		 * **Only works if the ID type is number.**
		 *
		 * @returns - the next usable ID.
		 */
		getNextId(): Promise<number>
	}
}
