declare module 'strato-db' {
	type EET = NodeJS.EventEmitter
	class EventEmitter implements EET {}

	/** A callback receiving an item */
	type ItemCallback<Item> = (obj: Item) => Promise<void>

	/** The value of the stored objects' id */
	type JMIDValue = string | number

	/**
	 * Stores Item objects in a SQLite table.
	 * Pass the type of the item it stores and the config so it can determine the columns
	 */
	export class JsonModel<
		RealItem extends JMObject<IDCol, IDType>,
		Config extends StrRecord & {idCol?: string} = {},
		IDCol extends string = Config extends {idCol: string}
			? Config['idCol']
			: 'id',
		Item = WithId<RealItem, IDCol>,
		InputItem = MaybeId<RealItem, IDCol>,
		IDType = RealItem[IDCol],
		Columns extends JMColumns<IDCol> = Config extends {columns: {}}
			? Config['columns']
			: // If we didn't get a config, assume all keys are columns
			  {[colName in keyof Item]: {}},
		ColNames extends string = Extract<keyof Columns, string>,
		SearchAttrs = JMSearchAttrs<ColNames>,
		SearchOptions = JMSearchOptions<ColNames>
	> {
		// TODO have it infer the columns from the call to super
		constructor(options: JMOptions<RealItem, Config, IDCol, IDType>)
		/** The DB instance storing this model */
		db: DB
		/** The table name */
		name: string
		/** The SQL-quoted table name */
		quoted: string
		/** The name of the id column */
		idCol: IDCol
		/** The SQL-quoted name of the id column */
		idColQ: string
		/** The prototype of returned Items */
		Item: Object
		/** The column definitions */
		columnArr: JMColumnDef[]
		/** The column definitions keyed by name */
		columns: Columns
		/** Parses a row as returned by sqlite */
		parseRow: (row: SQLiteRow, options?: SearchOptions) => Item
		/**
		 * Parses query options into query parts. Override this function to implement
		 * search behaviors.
		 */
		makeSelect(
			/** The query options. */
			options: SearchOptions
		): [string, SQLiteParam[], string[], string, SQLiteParam[]]
		/**
		 * Search the first matching object.
		 *
		 * @returns The result or undefined if no match.
		 */
		searchOne(
			/** Simple value attributes. */
			attrs: SearchAttrs,
			options?: SearchOptions
		): Promise<Item | undefined>
		/**
		 * Search the all matching objects.
		 *
		 * @returns - `{items[], cursor}`. If no cursor, you got all the results.
		 *          If `options.itemsOnly`, returns only the items array.
		 */
		search<
			T extends boolean | null | undefined,
			R = T extends true ? Item[] : {items: Item[]; cursor: string}
		>(
			/** Simple value attributes. */
			attrs?: SearchAttrs,
			options?: SearchOptions & {
				itemsOnly?: T
			}
		): Promise<R>
		/**
		 * A shortcut for setting `itemsOnly: true` on {@link search}.
		 *
		 * @param attrs      - simple value attributes.
		 * @param [options]  - search options.
		 * @returns - the search results.
		 */
		searchAll(attrs: SearchAttrs, options?: SearchOptions): Promise<Item[]>
		/**
		 * Check for existence of objects. Returns `true` if the search would yield
		 * results.
		 *
		 * @returns The search results exist.
		 */
		exists(id: IDType): Promise<boolean>
		exists(attrs: SearchAttrs, options?: SearchOptions): Promise<boolean>
		/**
		 * Count of search results.
		 *
		 * @returns - the count.
		 */
		count(attrs?: SearchAttrs, options?: SearchOptions): Promise<number>
		/**
		 * Numeric Aggregate Operation.
		 */
		numAggOp(
			/** The SQL function, e.g. MAX. */
			op: string,
			/** The column to aggregate. */
			colName: JMColName,
			attrs?: SearchAttrs,
			options?: SearchOptions
		): Promise<number>
		/**
		 * Maximum value.
		 */
		max(
			colName: JMColName,
			attrs?: SearchAttrs,
			options?: SearchOptions
		): Promise<number>
		/**
		 * Minimum value.
		 */
		min(
			colName: JMColName,
			attrs?: SearchAttrs,
			options?: SearchOptions
		): Promise<number>
		/**
		 * Sum values.
		 */
		sum(
			colName: JMColName,
			attrs?: SearchAttrs,
			options?: SearchOptions
		): Promise<number>
		/**
		 * Average value.
		 */
		avg(
			colName: JMColName,
			attrs?: SearchAttrs,
			options?: SearchOptions
		): Promise<number>
		/**
		 * Get all objects. This can result in out-of-memory errors.
		 *
		 * @returns - the table contents.
		 */
		all(): Promise<Item[]>
		/**
		 * Get an object by a unique value, like its ID.
		 *
		 * @returns - the object if it exists.
		 */
		get(
			/** The value for the column */
			id: SQLiteParam,
			/** The column name, defaults to the ID column */
			colName?: JMColName
		): Promise<Item | undefined>
		/**
		 * Get several objects by their unique value, like their ID.
		 *
		 * @returns - the objects, or undefined where they don't exist, in order of
		 *          their requested ID.
		 */
		getAll(
			/** The values for the column */
			ids: SQLiteParam[],
			/** The column name, defaults to the ID column */
			colName?: JMColName
		): Promise<(Item | undefined)[]>
		/**
		 * Get an object by a unique value, like its ID, using a cache.
		 * This also coalesces multiple calls in the same tick into a single query,
		 * courtesy of DataLoader.
		 *
		 * @returns - the object if it exists. It will be cached.
		 */
		getCached(
			/** The lookup cache. It is managed with DataLoader. */
			// We add the {} to allow easy initialization
			cache: JMCache<Item, IDCol> | {},
			/** The value for the column */
			id: SQLiteParam,
			/** The column name, defaults to the ID column */
			colName?: JMColName
		): Promise<Item | undefined>
		/**
		 * Lets you clear all the cache or just a key. Useful for when you change only
		 * some items.
		 *
		 * @returns - the column cache, you can call `.prime(key, value)` on it to
		 *          insert a value.
		 */
		clearCache(
			/** The lookup cache. It is managed with DataLoader. */
			cache: JMCache<Item, IDCol>,
			id?: IDType,
			colName?: string
		): Loader<Item, IDType>
		/**
		 * Iterate through search results. Calls `fn` on every result.
		 * The iteration uses a cursored search, so changes to the model during the
		 * iteration can influence the iteration.
		 *
		 * @returns Table iteration completed.
		 */
		each(cb: ItemCallback<Item>): Promise<void>
		each(attrs: SearchAttrs, cb: ItemCallback<Item>): Promise<void>
		each(
			attrs: SearchAttrs,
			opts: SearchOptions,
			cb: ItemCallback<Item>
		): Promise<void>
		/**
		 * Insert or replace the given object into the database.
		 *
		 * @param obj           - the object to store. If there is no `id` value
		 *                      (or whatever the `id` column is named), one is
		 *                      assigned automatically.
		 * @param [insertOnly]  - don't allow replacing existing objects.
		 * @param [noReturn]    - do not return the stored object; an optimization.
		 * @returns - if `noReturn` is false, the stored object is fetched from the
		 *          DB.
		 */
		set(obj: InputItem, insertOnly?: boolean, noReturn?: boolean): Promise<Item>
		/**
		 * Update or upsert an object. This uses a transaction if one is not active.
		 *
		 * @param obj         - The changes to store, including the id field.
		 * @param [upsert]    - Insert the object if it doesn't exist.
		 * @param [noReturn]  - Do not return the stored object, preventing a
		 *                    query.
		 * @returns A copy of the stored object.
		 */
		update(obj: Item, upsert?: boolean, noReturn?: boolean): Promise<Item>
		/**
		 * Update or upsert an object. This does not use a transaction so is open to
		 * race conditions if you don't run it in a transaction.
		 *
		 * @param obj         - The changes to store, including the id field.
		 * @param [upsert]    - Insert the object if it doesn't exist.
		 * @param [noReturn]  - Do not return the stored object, preventing a
		 *                    query.
		 * @returns A copy of the stored object.
		 */
		updateNoTrans(obj: Item, upsert?: false, noReturn?: boolean): Promise<Item>
		updateNoTrans(obj: Item, upsert: true, noReturn?: boolean): Promise<Item>
		/**
		 * Remove an object. If the object doesn't exist, this doesn't do anything.
		 *
		 * @param idOrObj  - The id or the object itself.
		 * @returns A promise for the deletion.
		 */
		remove(idOrObj: IDType | Item): Promise<void>
		/**
		 * "Rename" an object.
		 *
		 * @param oldId  - The current ID. If it doesn't exist this will throw.
		 * @param newId  - The new ID. If this ID is already in use this will
		 *               throw.
		 * @returns A promise for the rename.
		 */
		changeId(oldId: IDType, newId: IDType): Promise<void>
	}

	export type ESEvent = {
		/** the version */
		v: number
		/** event type */
		type: string
		/** ms since epoch of event */
		ts: number
		/** event data */
		data?: any
		/** event processing result */
		result?: Record<string, ReduceResult>
	}
	type EQOptions<
		M extends EventQueue<T, C>,
		T extends ESEvent,
		C extends StrRecord
	> = JMOptions<M, T, EQConfig<C>, 'v', number> & {
		/** the table name, defaults to `"history"` */
		name?: string
		/** should getNext poll forever? */
		forever?: boolean
		/** add views to the database to assist with inspecting the data */
		withViews?: boolean
	}
	type EQColumns = {
		v: {type: 'INTEGER'}
		type: {type: 'TEXT'}
		ts: {type: 'INTEGER'}
		data: {type: 'JSON'}
		result: {type: 'JSON'}
		size: {type: 'INTEGER'; default: 0; get: false}
	}
	type EQConfig<Config> = Config & {
		columns: EQColumns
		idCol: 'v'
	}
	/**
	 * Creates a new EventQueue model, called by DB.
	 */
	export interface EventQueue<
		Evt extends ESEvent = ESEvent,
		Config extends StrRecord & {idCol?: 'v'} = {}
	> extends JsonModel<Evt, EQConfig<Config>, 'v'> {
		new <M extends EventQueue<T, C>, T extends ESEvent, C>(
			options: EQOptions<M, T, C>
		): this
		/**
		 * Get the highest version stored in the queue.
		 *
		 * @returns - the version.
		 */
		getMaxV(): Promise<number>
		/**
		 * Atomically add an event to the queue.
		 *
		 * @param type             - event type.
		 * @param [data]           - event data.
		 * @param [ts=Date.now()]  - event timestamp, ms since epoch.
		 * @returns - Promise for the added event.
		 */
		add(type: string, data?: any, ts?: number): Promise<Evt>
		/**
		 * Get the next event after v (gaps are ok).
		 * The wait can be cancelled by `.cancelNext()`.
		 *
		 * @param [v=0]           - the version.
		 * @param [noWait=false]  - do not wait for the next event.
		 * @returns The event if found.
		 */
		getNext(v?: number, noWait?: boolean): Promise<Evt>
		/**
		 * Cancel any pending `.getNext()` calls
		 */
		cancelNext(): void
		/**
		 * Set the latest known version.
		 * New events will have higher versions.
		 *
		 * @param v  - the last known version.
		 */
		setKnownV(v: number): Promise<void>
	}

	export type ReduceResult = Record<string, any>
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
