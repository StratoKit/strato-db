var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import "uuid";
import { isEqual } from "lodash";
import "../DB/DB.mjs";
import "../DB/SQLite.mjs";
import JsonModelImpl from "../JsonModel/JsonModel.mjs";
import { DEV } from "../lib/warning.mjs";
import applyResult from "./applyResult.mjs";
const undefToNull = (data) => {
  if (data == null)
    return null;
  if (typeof data !== "object")
    return data;
  if (Array.isArray(data))
    return data.map((element) => undefToNull(element));
  if (Object.getPrototypeOf(data) !== Object.prototype)
    return data;
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = undefToNull(value);
  }
  return out;
};
const getId = async (model, data) => {
  let id = data[model.idCol];
  if (id == null) {
    id = await model.columns[model.idCol].value.call(model, data);
  }
  if (id == null)
    id = await model.getNextId();
  return id;
};
const calcUpd = (idCol, prev, obj, complete) => {
  const out = {};
  let changed = false;
  for (const [key, value] of Object.entries(obj)) {
    const pVal = prev[key];
    if (value == null && pVal != null) {
      out[key] = null;
      changed = true;
    } else if (!isEqual(value, pVal)) {
      out[key] = value;
      changed = true;
    }
  }
  if (complete) {
    for (const key of Object.keys(prev))
      if (!(key in obj)) {
        out[key] = null;
        changed = true;
      }
  }
  if (changed) {
    out[idCol] = prev[idCol];
    return out;
  }
  return void 0;
};
const _ESModel = class _ESModel extends JsonModelImpl {
  /**
   * Creates a new ESModel model, called by DB.
   *
   * @class
   * @param {function} dispatch      - the {@link ESDB} dispatch function.
   * @param {boolean}  [init]        - emit an event with type
   *                                 `es/INIT:${modelname}` at table creation
   *                                 time, to be used by custom reducers.
   * @param {Object}   [...options]  - other params are passed to JsonModel.
   */
  constructor({ dispatch, init, emitter, ...options }) {
    super({
      ...options,
      migrations: {
        ...options.migrations,
        "0_init": init && (({ queue }) => {
          queue.add(this.INIT);
        })
      }
    });
    __publicField(this, "TYPE", `es/${this.name}`);
    __publicField(this, "INIT", `es/INIT:${this.name}`);
    __publicField(this, "event", {
      /**
       * Create an event that will insert or replace the given object into the
       * database.
       *
       * @param {Object}  obj           - the object to store. If there is no `id`
       *                                value (or whatever the `id` column is
       *                                named), one is assigned automatically.
       * @param {boolean} [insertOnly]  - don't allow replacing existing objects.
       * @param {*}       [meta]        - extra metadata to store in the event but
       *                                not in the object.
       * @returns {Pick<ESEvent, 'type' | 'data'>} - args to pass to
       *                                           addEvent/dispatch.
       */
      set: (obj, insertOnly, meta) => {
        const data = [insertOnly ? _ESModel.INSERT : _ESModel.SET, null, obj];
        if (meta)
          data[3] = meta;
        return { type: this.TYPE, data };
      },
      /**
       * Create an event that will update an existing object.
       *
       * @param {Object}  obj       - the data to store.
       * @param {boolean} [upsert]  - if `true`, allow inserting if the object
       *                            doesn't exist.
       * @param {*}       [meta]    - extra metadata to store in the event at
       *                            `data[3]` but not in the object.
       * @returns {Pick<ESEvent, 'type' | 'data'>} - args to pass to
       *                                           addEvent/dispatch.
       */
      update: (obj, upsert, meta) => {
        const id = obj[this.idCol];
        if (id == null && !upsert)
          throw new TypeError("No ID specified");
        const data = [
          upsert ? _ESModel.SAVE : _ESModel.UPDATE,
          null,
          undefToNull(obj)
        ];
        if (meta)
          data.push(meta);
        return { type: this.TYPE, data };
      },
      /**
       * Create an event that will emove an object.
       *
       * @param {Object | string | integer} idOrObj
       * - the id or the object itself.
       * @param {*} meta
       * - metadata, attached to the event only, at `data[3]`
       * @returns {Pick<ESEvent, 'type' | 'data'>} - args to pass to
       *                                           addEvent/dispatch.
       */
      remove: (idOrObj, meta) => {
        const id = typeof idOrObj === "object" ? idOrObj[this.idCol] : idOrObj;
        if (id == null)
          throw new TypeError("No ID specified");
        const data = [_ESModel.REMOVE, id];
        if (meta)
          data[3] = meta;
        return { type: this.TYPE, data };
      }
    });
    __publicField(this, "_maxId", 0);
    __publicField(this, "_maxIdP", null);
    __publicField(this, "_lastUV", 0);
    this.dispatch = dispatch;
    this.writable = false;
    const clearMax = () => {
      this._maxId = 0;
    };
    options.db.setMaxListeners(options.db.getMaxListeners() + 1);
    options.db.on("begin", clearMax);
    emitter.setMaxListeners(emitter.getMaxListeners() + 1);
    emitter.on("result", clearMax);
    emitter.on("error", clearMax);
  }
  /**
   * Slight hack: use the writable state to fall back to JsonModel behavior.
   * This makes deriver and migrations work without changes.
   * Note: while writable, no events are created. Be careful.
   *
   * @param {boolean} state  - writeable or not.
   */
  setWritable(state) {
    this.writable = state;
  }
  /**
   * Insert or replace the given object into the database.
   *
   * @param {Object}  obj           - the object to store. If there is no `id`
   *                                value (or whatever the `id` column is named),
   *                                one is assigned automatically.
   * @param {boolean} [insertOnly]  - don't allow replacing existing objects.
   * @param {boolean} [noReturn]    - do not return the stored object; an
   *                                optimization.
   * @param {*}       [meta]        - extra metadata to store in the event but
   *                                not in the object.
   * @returns {Promise<Object>} - if `noReturn` is false, the stored object is
   *                            fetched from the DB.
   */
  async set(obj, insertOnly, noReturn, meta) {
    if (DEV && noReturn != null && typeof noReturn !== "boolean")
      throw new Error(`${this.name}: meta argument is now in fourth position`);
    if (this.writable) {
      const id2 = obj[this.idCol];
      if (this._maxId && id2 > this._maxId)
        this._maxId = id2;
      return super.set(obj, insertOnly, noReturn);
    }
    const { data, result } = await this.dispatch(
      this.event.set(obj, insertOnly, meta)
    );
    const id = data[1];
    const r = result[this.name];
    if (r && r.esFail)
      throw new Error(`${this.name}.set ${id}: ${r.esFail}`);
    return noReturn ? void 0 : this.get(id);
  }
  /**
   * Update an existing object.
   *
   * @param {Object}  o           - the data to store.
   * @param {boolean} [upsert]    - if `true`, allow inserting if the object
   *                              doesn't exist.
   * @param {boolean} [noReturn]  - do not return the stored object; an
   *                              optimization.
   * @param {*}       [meta]      - extra metadata to store in the event at
   *                              `data[3]` but not in the object.
   * @returns {Promise<Object>} - if `noReturn` is false, the stored object is
   *                            fetched from the DB.
   */
  async update(obj, upsert, noReturn, meta) {
    if (DEV && noReturn != null && typeof noReturn !== "boolean")
      throw new Error(`${this.name}: meta argument is now in fourth position`);
    if (this.writable)
      return super.update(obj, upsert, noReturn);
    if (DEV && noReturn != null && typeof noReturn !== "boolean")
      throw new Error(`${this.name}: meta argument is now in fourth position`);
    const { data, result } = await this.dispatch(
      this.event.update(obj, upsert, meta)
    );
    const id = data[1];
    const r = result[this.name];
    if (r && r.esFail)
      throw new Error(`${this.name}.update ${id}: ${r.esFail}`);
    return this.get(id);
  }
  updateNoTrans(obj, upsert) {
    if (this.writable)
      return super.updateNoTrans(obj, upsert);
    throw new Error("Non-transactional changes are not possible with ESModel");
  }
  /**
   * Remove an object.
   *
   * @param {Object | string | integer} idOrObj
   * - the id or the object itself.
   * @param {*} meta
   * - metadata, attached to the event only, at `data[3]`
   * @returns {Promise<boolean>} - always returns true.
   */
  async remove(idOrObj, meta) {
    if (this.writable)
      return super.remove(idOrObj);
    await this.dispatch(this.event.remove(idOrObj, meta));
    return true;
  }
  /** changeId: not implemented yet, had no need so far */
  changeId(oldId, newId) {
    if (this.writable)
      return super.changeId(oldId, newId);
    throw new Error(`ESModel doesn't support changeId yet`);
  }
  /**
   * Returns the next available integer ID for the model.
   * Calling this multiple times during a redux cycle will give increasing
   * numbers even though the database table doesn't change.
   * Use this from the redux functions to assign unique ids to new objects.
   *
   * @returns {Promise<number>} - the next usable ID.
   */
  async getNextId() {
    if (!this._maxId) {
      if (!this._maxIdP)
        this._maxIdP = this.max(this.idCol).then((m) => {
          this._maxId = m;
          return m;
        });
      await this._maxIdP;
      this._maxIdP = null;
    }
    return ++this._maxId;
  }
  /**
   * Applies the result from the reducer.
   *
   * @param {Object} result  - free-form change descriptor.
   * @returns {Promise<void>} - Promise for completion.
   */
  async applyResult(result) {
    if (result.esFail)
      return;
    return applyResult(this, { ...result, esFail: void 0 });
  }
  /**
   * Assigns the object id to the event at the start of the cycle.
   * When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)
   */
  static async preprocessor({ model, event, isMainEvent }) {
    if (isMainEvent)
      model._maxId = 0;
    if (event.type !== model.TYPE)
      return;
    if (event.data[0] > _ESModel.REMOVE) {
      event.data[1] = await getId(model, event.data[2]);
      return event;
    }
  }
  /**
   * Calculates the desired change ESModel will only emit `rm`, `ins`, `upd` and
   * `esFail`
   *
   * @param {Object}  params
   * @param {ESModel} params.model  - the model.
   * @param {Event}   params.event  - the event.
   * @returns {Promise<Object>} - the result object in the format JsonModel
   *                            likes.
   */
  static async reducer({ model, event: { type, data } }) {
    if (!model || type !== model.TYPE)
      return false;
    let [action, id, obj] = data;
    if (action === _ESModel.REMOVE) {
      if (await model.exists({ [model.idCol]: id }))
        return { rm: [id] };
      return false;
    }
    if (obj[model.idCol] == null)
      obj = { ...obj, [model.idCol]: id };
    const prev = await model.get(id);
    let update;
    if (prev) {
      if (action === _ESModel.INSERT)
        return { esFail: "EEXIST" };
      update = calcUpd(model.idCol, prev, obj, action === _ESModel.SET);
      return update ? { upd: [update] } : false;
    }
    if (action === _ESModel.UPDATE)
      return { esFail: "ENOENT" };
    return { ins: [obj] };
  }
};
__publicField(_ESModel, "REMOVE", 0);
__publicField(_ESModel, "SET", 1);
__publicField(_ESModel, "INSERT", 2);
__publicField(_ESModel, "UPDATE", 3);
__publicField(_ESModel, "SAVE", 4);
let ESModel = _ESModel;
export {
  ESModel as default,
  getId,
  undefToNull
};
