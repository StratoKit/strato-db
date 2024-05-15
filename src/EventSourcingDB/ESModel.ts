/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Drop-in replacement for JsonModel
// Caveats:
// * `.update()` returns the current object at the time of returning, not the one that was updated
//
// Events all have type `es/name` and data `[actionEnum, id, obj, meta]`
// The id is assigned by the preprocessor except for removes

import JsonModel from '../JsonModel'
import {DEV} from '../lib/warning'
import {isEqual} from 'lodash'
import applyResult from './applyResult'
import {
	IIf,
	JMBaseConfig,
	JMColumnDef,
	JMColumns,
	JMConfig,
	JMIDType,
	JMJsonRecord,
	JMMigrationExtraArgs,
	JMModelName,
	JMRecord,
	JMSearchAttrs,
	JMSearchOptions,
	MaybeId,
	WithId,
} from '../JsonModel/JsonModel'
import {DispatchFn, ESDBModel, ReduceResult} from './EventSourcingDB'
import {SQLiteChangesMeta} from '../DB/SQLite'
import {ESEvent} from '../EventQueue'

export const undefToNull = data => {
	if (data == null) return null
	if (typeof data !== 'object') return data
	if (Array.isArray(data)) return data.map(element => undefToNull(element))
	if (Object.getPrototypeOf(data) !== Object.prototype) return data
	const out = {}
	for (const [key, value] of Object.entries(data)) {
		out[key] = undefToNull(value)
	}
	return out
}

export const getId = async (model, data) => {
	let id = data[model.idCol]
	if (id == null) {
		// Be sure to call with model as this, like in JsonModel
		id = await model.columns[model.idCol].value.call(model, data)
	}
	// This can only happen for integer ids
	if (id == null) id = await model.getNextId()
	return id
}

// Calculate the update given two objects that went
// through JSON stringify+parse
const calcUpd = (idCol, prev, obj, complete) => {
	const out = {}
	let changed = false
	for (const [key, value] of Object.entries(obj)) {
		const pVal = prev[key]
		if (value == null && pVal != null) {
			out[key] = null
			changed = true
		} else if (!isEqual(value, pVal)) {
			out[key] = value
			changed = true
		}
	}
	if (complete)
		for (const key of Object.keys(prev))
			if (!(key in obj)) {
				out[key] = null
				changed = true
			}
	if (changed) {
		out[idCol] = prev[idCol]
		return out
	}
	return undefined
}

/**
 * ESModel is a drop-in wrapper around JsonModel to turn changes into events.
 *
 * Use it to convert your database to be event sourcing
 *
 * Event data is encoded as an array: `[subtype, id, data, meta]`
 * Subtype is one of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`.
 * `id` is filled in by the preprocessor at the time of the event.
 * `meta` is free-form data about the event. It is just stored in the history
 * table.
 *d
 * For example: `model.set({foo: true})` would result in the event `[1, 1, {foo:
 * true}]`
 * Pass the type of the item it stores and the config so it can determine the columns
 */
class ESModel<
		ItemType extends JMRecord = JMJsonRecord,
		Config extends JMBaseConfig = {name: 'unknown'},
		//
		// Inferred generics below
		//
		IDCol extends string = Config['idCol'] extends string
			? Config['idCol']
			: 'id',
		IDType extends JMIDType = ItemType[IDCol] extends JMIDType
			? ItemType[IDCol]
			: string,
		InputItem extends MaybeId<Partial<ItemType>, IDCol, IDType> = MaybeId<
			Partial<ItemType>,
			IDCol,
			IDType
		>,
		DBItem extends WithId<ItemType, IDCol, IDType> = WithId<
			ItemType,
			IDCol,
			IDType
		>,
		Name extends JMModelName = Config['name'],
		Columns extends
			JMColumns<IDCol> = Config['columns'] extends JMColumns<IDCol>
			? Config['columns']
			: // If we didn't get a config, assume all keys are columns
			  {[colName in keyof DBItem]: JMColumnDef},
		ColName extends string | IDCol | 'json' =
			| Extract<keyof Columns, string>
			| IDCol
			| 'json',
		SearchAttrs extends JMSearchAttrs<ColName> = JMSearchAttrs<ColName>,
		SearchOptions extends JMSearchOptions<ColName> = JMSearchOptions<ColName>,
		MigrationArgs extends
			JMMigrationExtraArgs = Config['migrationOptions'] extends JMMigrationExtraArgs
			? Config['migrationOptions']
			: JMMigrationExtraArgs,
		RealConfig extends JMConfig<IDCol, ItemType, MigrationArgs> & {
			/** emit an event with type `es/INIT:${modelname}` at table creation time, to be used by custom reducers.*/
			init?: boolean
			/** @deprecated The ESDB dispatch function, provided by ESDB. */
			dispatch?: DispatchFn
			/** @deprecated The ESDB event emitter, provided by ESDB. */
			emitter?: NodeJS.EventEmitter
		} = JMConfig<IDCol, ItemType, MigrationArgs>,
	>
	extends JsonModel<
		ItemType,
		Config,
		IDCol,
		IDType,
		InputItem,
		DBItem,
		Name,
		Columns,
		ColName,
		SearchAttrs,
		SearchOptions,
		MigrationArgs,
		RealConfig
	>
	implements ESDBModel
{
	static REMOVE = 0
	static SET = 1
	static INSERT = 2
	static UPDATE = 3
	static SAVE = 4

	TYPE = `es/${this.name}`
	INIT = `es/INIT:${this.name}`

	declare dispatch: DispatchFn
	declare writable: boolean

	/**
	 * Creates a new ESModel model, called by DB.
	 */
	constructor({init, dispatch, emitter, ...options}: RealConfig) {
		super({
			...options,
			migrations: {
				...options.migrations,
				'0_init':
					init &&
					(({queue}) => {
						// Don't wait for add Promise to prevent deadlock
						queue.add(this.INIT)
					}),
			},
		} as unknown as RealConfig)
		this.dispatch = dispatch!
		this.writable = false

		// eslint-disable-next-line unicorn/consistent-function-scoping
		const clearMax = () => {
			this._maxId = 0
		}

		// Prevent max listeners warning
		const db = options.db!
		db.setMaxListeners(db.getMaxListeners() + 1)
		db.on('begin', clearMax)
		emitter!.setMaxListeners(emitter!.getMaxListeners() + 1)
		emitter!.on('result', clearMax)
		emitter!.on('error', clearMax)
	}

	/**
	 * Slight hack: use the writable state to fall back to JsonModel behavior.
	 * This makes deriver and migrations work without changes.
	 * Note: while writable, no events are created. Be careful.
	 *
	 * @param state  - writeable or not.
	 */
	setWritable(state: boolean) {
		this.writable = state
	}

	event = {
		/**
		 * Create an event that will insert or replace the given object into the
		 * database.
		 *
		 * @param obj           - the object to store. If there is no `id`
		 *                      value (or whatever the `id` column is named), one
		 *                      is assigned automatically.
		 * @param [insertOnly]  - don't allow replacing existing objects.
		 * @param [meta]        - extra metadata to store in the event but not in
		 *                      the object.
		 * @returns - args to pass to addEvent/dispatch.
		 */
		set: (obj: InputItem, insertOnly?: boolean, meta?: any) => {
			const data = [insertOnly ? ESModel.INSERT : ESModel.SET, null, obj]
			if (meta) data[3] = meta
			return {type: this.TYPE, data}
		},
		/**
		 * Create an event that will update an existing object.
		 *
		 * @param changes   - the data to store.
		 * @param [upsert]  - if `true`, allow inserting if the object doesn't
		 *                  exist.
		 * @param [meta]    - extra metadata to store in the event at `data[3]` but
		 *                  not in the object.
		 * @returns - args to pass to addEvent/dispatch.
		 */
		update: (changes: InputItem, upsert?: boolean, meta?: any) => {
			const id = changes[this.idCol]
			if (id == null && !upsert) throw new TypeError('No ID specified')

			const data = [
				upsert ? ESModel.SAVE : ESModel.UPDATE,
				null,
				undefToNull(changes),
			]
			if (meta) data.push(meta)

			return {type: this.TYPE, data}
		},
		/**
		 * Create an event that will remove an object.
		 *
		 * @param idOrObj  - the id or the object itself.
		 * @param meta     - metadata, attached to the event only, at `data[3]`
		 * @returns - args to pass to addEvent/dispatch.
		 */
		remove: (idOrObj: IDCol | DBItem, meta?: any) => {
			const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj
			if (id == null) throw new TypeError('No ID specified')

			const data = [ESModel.REMOVE, id]
			if (meta) data[3] = meta

			return {type: this.TYPE, data}
		},
	}

	/**
	 * Insert or replace the given object into the database.
	 *
	 * @param obj           - the object to store. If there is no `id`
	 *                      value (or whatever the `id` column is named),
	 *                      one is assigned automatically.
	 * @param [insertOnly]  - don't allow replacing existing objects.
	 * @param [noReturn]    - do not return the stored object; an optimization.
	 * @param [meta]        - extra metadata to store in the event but not in
	 *                      the object.
	 * @returns - if `noReturn` is false, the stored object is fetched from the
	 *          DB.
	 */
	async set<NoReturn extends boolean>(
		obj: InputItem,
		insertOnly?: boolean,
		noReturn?: NoReturn,
		meta?: any
	) {
		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)
		if (this.writable) {
			const id = obj[this.idCol] as number
			if (this._maxId && id > this._maxId) this._maxId = id
			return super.set(obj, insertOnly, noReturn)
		}

		const {data, result} = await this.dispatch(
			this.event.set(obj, insertOnly, meta)
		)
		const id = data[1]

		const r = result![this.name]
		if (r && r.esFail) throw new Error(`${this.name}.set ${id}: ${r.esFail}`)

		// We have to get because we don't know what calculated values did
		// Unfortunately, this might be the object after a later event
		return (noReturn ? undefined : await this.get(id)) as IIf<
			NoReturn,
			SQLiteChangesMeta | undefined,
			DBItem
		>
	}

	/**
	 * Update an existing object.
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
	async update<NoReturn extends boolean>(
		changes: InputItem,
		upsert?: boolean,
		noReturn?: NoReturn,
		meta?: any
	) {
		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)

		if (this.writable) return super.update(changes, upsert, noReturn)

		if (DEV && noReturn != null && typeof noReturn !== 'boolean')
			throw new Error(`${this.name}: meta argument is now in fourth position`)

		const {data, result} = await this.dispatch(
			this.event.update(changes, upsert, meta)
		)
		const id = data[1]

		const r = result![this.name]
		if (r && r.esFail) throw new Error(`${this.name}.update ${id}: ${r.esFail}`)

		// We have to get because we don't know what calculated values did
		// Unfortunately, this might be the object after a later event
		return (noReturn ? undefined : this.get(id)) as Promise<
			IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>
		>
	}

	updateNoTrans<NoReturn extends boolean>(
		obj: InputItem,
		upsert?: boolean,
		noReturn?: NoReturn
	): Promise<IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>> {
		if (this.writable)
			return super.updateNoTrans(obj, upsert, noReturn) as Promise<
				IIf<NoReturn, SQLiteChangesMeta | undefined, DBItem>
			>
		throw new Error('Non-transactional changes are not possible with ESModel')
	}

	/**
	 * Remove an object.
	 *
	 * @param idOrObj  - the id or the object itself.
	 * @param meta     - metadata, attached to the event only, at `data[3]`
	 */
	async remove(idOrObj: IDCol | DBItem, meta?: any) {
		if (this.writable) return super.remove(idOrObj)

		await this.dispatch(this.event.remove(idOrObj, meta))
		return undefined
	}

	/** changeId: not implemented yet, had no need so far */
	changeId(oldId, newId) {
		if (this.writable) return super.changeId(oldId, newId)
		throw new Error(`ESModel doesn't support changeId yet`)
	}

	// Maximum id if id type is number
	_maxId = 0
	declare _maxIdP?: Promise<number>
	_lastUV = 0

	/**
	 * Returns the next available integer ID for the model.
	 * Calling this multiple times during a redux cycle will give increasing
	 * numbers even though the database table doesn't change.
	 * Use this from the redux functions to assign unique ids to new objects.
	 *
	 * @returns - the next usable ID.
	 */
	async getNextId() {
		if (!this._maxId) {
			if (!this._maxIdP)
				this._maxIdP = this.max(this.idCol as ColName).then(m => {
					this._maxId = m
					return m
				})
			await this._maxIdP
			this._maxIdP = undefined
		}
		return ++this._maxId
	}

	/**
	 * Applies the result from the reducer.
	 *
	 * @param result  - free-form change descriptor.
	 * @returns - Promise for completion.
	 */
	async applyResult(result: ReduceResult) {
		if (result.esFail) return
		return applyResult(this, {...result, esFail: undefined})
	}

	/**
	 * Assigns the object id to the event at the start of the cycle.
	 * When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)
	 */
	static async preprocessor({model, event, isMainEvent}) {
		if (isMainEvent) model._maxId = 0
		if (event.type !== model.TYPE) return
		if (event.data[0] > ESModel.REMOVE) {
			// Always overwrite, so repeat events get correct ids
			// eslint-disable-next-line require-atomic-updates
			event.data[1] = await getId(model, event.data[2])
			return event
		}
	}

	/**
	 * Calculates the desired change ESModel will only emit `rm`, `ins`, `upd` and
	 * `esFail`
	 *
	 * @param params
	 * @param params.model  - the model.
	 * @param params.event  - the event.
	 * @returns - the result object in the format JsonModel likes.
	 */
	static async reducer({
		model,
		event: {type, data},
	}: {
		/** The model */
		model: ESModel
		event: ESEvent
	}): Promise<ReduceResult | false> {
		if (!model || type !== model.TYPE) return false

		const [action, id] = data
		let obj = data[2]
		if (action === ESModel.REMOVE) {
			if (await model.exists({[model.idCol]: id})) return {rm: [id]}
			return false
		}

		if (obj[model.idCol] == null) obj = {...obj, [model.idCol]: id}

		const prev = await model.get(id)
		let update
		if (prev) {
			if (action === ESModel.INSERT) return {esFail: 'EEXIST'}
			update = calcUpd(model.idCol, prev, obj, action === ESModel.SET)
			return update ? {upd: [update]} : false
		}
		if (action === ESModel.UPDATE) return {esFail: 'ENOENT'}
		return {ins: [obj]}
	}
}

export default ESModel
