"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.getId = exports.undefToNull = void 0;

var _isEqual2 = _interopRequireDefault(require("lodash/isEqual"));

var _JsonModel = _interopRequireDefault(require("../JsonModel"));

var _warning = require("../lib/warning");

var _applyResult = _interopRequireDefault(require("./applyResult"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const undefToNull = data => {
  if (data == null) return null;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(undefToNull);
  if (Object.getPrototypeOf(data) !== Object.prototype) return data;
  const out = {};
  Object.entries(data).forEach(([key, value]) => {
    out[key] = undefToNull(value);
  });
  return out;
};

exports.undefToNull = undefToNull;

const getId = async (model, data) => {
  let id = data[model.idCol];

  if (id == null) {
    // Be sure to call with model as this, like in JsonModel
    id = await model.columns[model.idCol].value.call(model, data);
  } // This can only happen for integer ids


  if (id == null) id = await model.getNextId();
  return id;
}; // Calculate the update given two objects that went
// through JSON stringify+parse


exports.getId = getId;

const calcUpd = (idCol, prev, obj, complete) => {
  const out = {};
  let changed = false;

  for (const [key, value] of Object.entries(obj)) {
    const pVal = prev[key];

    if (value == null && pVal != null) {
      out[key] = null;
      changed = true;
    } else if (!(0, _isEqual2.default)(value, pVal)) {
      out[key] = value;
      changed = true;
    }
  }

  if (complete) for (const key of Object.keys(prev)) if (!(key in obj)) {
    out[key] = null;
    changed = true;
  }

  if (changed) {
    out[idCol] = prev[idCol];
    return out;
  }

  return undefined;
};
/**
 * ESModel is a drop-in wrapper around JsonModel to turn changes into events.
 *
 * Use it to convert your database to be event sourcing
 *
 * Event data is encoded as an array: `[subtype, id, data, meta]`
 * Subtype is one of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`.
 * `id` is filled in by the preprocessor at the time of the event.
 * `meta` is free-form data about the event. It is just stored in the history table.
 *
 * For example: `model.set({foo: true})` would result in the event
 * `[1, 1, {foo: true}]`
 * @extends JsonModel
 */


class ESModel extends _JsonModel.default {
  /* eslint-disable lines-between-class-members */

  /* eslint-enable lines-between-class-members */

  /**
   * Creates a new ESModel model, called by DB
   * @constructor
   * @param  {function} dispatch - the {@link ESDB} dispatch function
   * @param  {boolean} [init] - emit an event with type `es/INIT:${modelname}` at table creation time, to be used by custom reducers
   * @param  {Object} [...options] - other params are passed to JsonModel
   */
  constructor(_ref) {
    let {
      dispatch,
      init,
      emitter
    } = _ref,
        options = _objectWithoutProperties(_ref, ["dispatch", "init", "emitter"]);

    super(_objectSpread({}, options, {
      migrations: _objectSpread({}, options.migrations, {
        '0_init': init && (({
          queue
        }) => queue.add(this.INIT))
      })
    }));

    _defineProperty(this, "TYPE", `es/${this.name}`);

    _defineProperty(this, "INIT", `es/INIT:${this.name}`);

    _defineProperty(this, "_maxId", 0);

    _defineProperty(this, "_lastUV", 0);

    this.dispatch = dispatch;
    this.writable = false;

    const clearMax = () => {
      this._maxId = 0;
    };

    options.db.on('begin', clearMax);
    emitter.on('result', clearMax);
    emitter.on('error', clearMax);
  }

  /**
   * Slight hack: use the writable state to fall back to JsonModel behavior.
   * This makes deriver and migrations work without changes.
   * Note: while writable, no events are created. Be careful.
   * @param {boolean} state - writeable or not
   */
  setWritable(state) {
    this.writable = state;
  }
  /**
   * Insert or replace the given object into the database
   *
   * @param  {object} obj - the object to store. If there is no `id` value (or whatever the `id` column is named), one is assigned automatically.
   * @param  {boolean} [insertOnly] - don't allow replacing existing objects
   * @param  {boolean} [noReturn] - do not return the stored object; an optimization
   * @param  {*} [meta] - extra metadata to store in the event but not in the object
   * @returns {Promise<Object>} - if `noReturn` is false, the stored object is fetched from the DB
   */


  async set(obj, insertOnly, noReturn, meta) {
    if (_warning.DEV && noReturn != null && typeof noReturn !== 'boolean') throw new Error(`${this.name}: meta argument is now in fourth position`);

    if (this.writable) {
      const id = obj[this.idCol];
      if (id > this._maxId) this._maxId = id;
      return super.set(obj, insertOnly, noReturn);
    }

    const d = [insertOnly ? ESModel.INSERT : ESModel.SET, null, obj];
    if (meta) d[3] = meta;
    const {
      data,
      result
    } = await this.dispatch(this.TYPE, d);
    const id = data[1];
    const r = result[this.name];
    if (r && r.esFail) throw new Error(`${this.name}.set ${id}: ${r.esFail}`); // We have to get because we don't know what calculated values did
    // Unfortunately, this might be the object after a later event

    return noReturn ? undefined : this.get(id);
  }
  /**
   * update an existing object
   * @param  {Object} o - the data to store
   * @param  {boolean} [upsert] - if `true`, allow inserting if the object doesn't exist
   * @param  {boolean} [noReturn] - do not return the stored object; an optimization
   * @param  {*} [meta] - extra metadata to store in the event at `data[3]` but not in the object
   * @returns {Promise<Object>} - if `noReturn` is false, the stored object is fetched from the DB
   */


  async update(o, upsert, noReturn, meta) {
    if (_warning.DEV && noReturn != null && typeof noReturn !== 'boolean') throw new Error(`${this.name}: meta argument is now in fourth position`);
    if (this.writable) return super.update(o, upsert, noReturn);
    if (_warning.DEV && noReturn != null && typeof noReturn !== 'boolean') throw new Error(`${this.name}: meta argument is now in fourth position`);
    let id = o[this.idCol];
    if (id == null && !upsert) throw new TypeError('No ID specified');
    const d = [upsert ? ESModel.SAVE : ESModel.UPDATE, null, undefToNull(o)];
    if (meta) d.push(meta);
    const {
      data,
      result
    } = await this.dispatch(this.TYPE, d);
    id = data[1];
    const r = result[this.name];
    if (r && r.esFail) throw new Error(`${this.name}.update ${id}: ${r.esFail}`); // We have to get because we don't know what calculated values did
    // Unfortunately, this might be the object after a later event

    return this.get(id);
  }

  updateNoTrans(obj, upsert) {
    if (this.writable) return super.updateNoTrans(obj, upsert);
    throw new Error('Non-transactional changes are not possible with ESModel');
  }
  /**
   * Remove an object
   * @param  {(Object|string|integer)} idOrObj - the id or the object itself
   * @param  {*} meta - metadata, attached to the event only, at `data[3]`
   * @returns {Promise<boolean>} - always returns true
   */


  async remove(idOrObj, meta) {
    if (this.writable) return super.remove(idOrObj);
    const id = typeof idOrObj === 'object' ? idOrObj[this.idCol] : idOrObj;
    if (id == null) throw new TypeError('No ID specified');
    const d = [ESModel.REMOVE, id];
    if (meta) d[3] = meta;
    await this.dispatch(this.TYPE, d);
    return true;
  }
  /** changeId: not implemented yet, had no need so far */


  changeId() {
    throw new Error(`ESModel doesn't support changeId yet`);
  }

  /**
   * Returns the next available integer ID for the model.
   * Calling this multiple times during a redux cycle will give increasing numbers
   * even though the database table doesn't change.
   * Use this from the redux functions to assign unique ids to new objects.
   * @returns {Promise<number>} - the next usable ID
   */
  async getNextId() {
    if (!this._maxId) this._maxId = await this.max(this.idCol);
    return ++this._maxId;
  }
  /**
   * Applies the result from the reducer
   * @param {Object} result - free-form change descriptor
   * @returns {Promise<void>} - Promise for completion
   */


  async applyResult(result) {
    this._maxId = 0;
    if (result.esFail) return;
    return (0, _applyResult.default)(this, _objectSpread({}, result, {
      esFail: undefined
    }));
  }
  /**
   * Assigns the object id to the event at the start of the cycle.
   * When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)
   */


  static async preprocessor({
    model,
    event,
    isMainEvent
  }) {
    if (isMainEvent) this._maxId = 0;
    if (event.type !== model.TYPE) return;

    if (event.data[0] > ESModel.REMOVE) {
      // Always overwrite, so repeat events get correct ids
      // eslint-disable-next-line require-atomic-updates
      event.data[1] = await getId(model, event.data[2]);
      return event;
    }
  }
  /**
   * Calculates the desired change
   * ESModel will only emit `rm`, `ins`, `upd` and `esFail`
   * @param {object} model - the model
   * @param {Event} event - the event
   * @returns {Promise<Object>} - the result object in the format JsonModel likes
   */


  static async reducer({
    model,
    event: {
      type,
      data
    }
  }) {
    if (!model || type !== model.TYPE) return false;
    let [action, id, obj] = data;

    if (action === ESModel.REMOVE) {
      if (await model.exists({
        [model.idCol]: id
      })) return {
        rm: [id]
      };
      return false;
    }

    if (obj[model.idCol] == null) obj = _objectSpread({}, obj, {
      [model.idCol]: id
    });
    const prev = await model.get(id);
    let update;

    if (prev) {
      if (action === ESModel.INSERT) return {
        esFail: 'EEXIST'
      };
      update = calcUpd(model.idCol, prev, obj, action === ESModel.SET);
      return update ? {
        upd: [update]
      } : false;
    }

    if (action === ESModel.UPDATE) return {
      esFail: 'ENOENT'
    };
    return {
      ins: [obj]
    };
  }

}

_defineProperty(ESModel, "REMOVE", 0);

_defineProperty(ESModel, "SET", 1);

_defineProperty(ESModel, "INSERT", 2);

_defineProperty(ESModel, "UPDATE", 3);

_defineProperty(ESModel, "SAVE", 4);

var _default = ESModel;
exports.default = _default;
//# sourceMappingURL=ESModel.js.map