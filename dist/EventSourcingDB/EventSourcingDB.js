"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _isEmpty2 = _interopRequireDefault(require("lodash/isEmpty"));

var _debug = _interopRequireDefault(require("debug"));

var _DB = _interopRequireDefault(require("../DB"));

var _ESModel = _interopRequireDefault(require("./ESModel"));

var _EventQueue = _interopRequireDefault(require("../EventQueue"));

var _events = _interopRequireDefault(require("events"));

var _settleAll = require("../lib/settleAll");

var _warning = require("../lib/warning");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const dbg = (0, _debug.default)('strato-db/ESDB');

const wait = ms => new Promise(r => setTimeout(r, ms));

const registerHistoryMigration = (rwDb, queue) => {
  rwDb.registerMigrations('historyExport', {
    2018040800: {
      up: async db => {
        const oldTable = await db.all('PRAGMA table_info(history)');
        if (!(oldTable.length === 4 && oldTable.some(c => c.name === 'json') && oldTable.some(c => c.name === 'v') && oldTable.some(c => c.name === 'type') && oldTable.some(c => c.name === 'ts'))) return;
        let allDone = Promise.resolve();
        await db.each('SELECT * from history', row => {
          allDone = allDone.then(() => queue.set(_objectSpread({}, row, {
            json: undefined
          }, JSON.parse(row.json))));
        });
        await allDone; // not dropping table, you can do that yourself :)
        // eslint-disable-next-line no-console

        console.error(`!!! history table in ${rwDb.file} is no longer needed`);
      }
    }
  });
};

const errorToString = error => {
  const msg = error ? error.stack || error.message || String(error) : new Error('missing error').stack;
  return String(msg).replace(/\s+/g, ' ');
};

const fixupOldReducer = (name, reducer) => {
  if (!reducer) return;

  if (reducer.length !== 1) {
    if (_warning.DEV) if (reducer.length === 0) {
      (0, _warning.deprecated)('varargsReducer', `${name}: reducer has a single argument now, don't use ...args`);
    } else {
      (0, _warning.deprecated)('oldReducer', `${name}: reducer has a single argument now, like preprocessor/deriver`);
    }
    const prev = reducer;

    reducer = args => prev(args.model, args.event, args);
  }

  return reducer;
};
/**
 * EventSourcingDB maintains a DB where all data is
 * atomically updated based on {@link Event events (free-form messages)}.
 * This is very similar to how Redux works in React.
 * @extends EventEmitter
 */


class EventSourcingDB extends _events.default {
  // this is an hour
  // eslint-disable-next-line complexity
  constructor(_ref) {
    let {
      queue,
      models,
      queueFile,
      withViews = true,
      onWillOpen,
      onBeforeMigrations: prevOBM,
      onDidOpen: prevODO
    } = _ref,
        dbOptions = _objectWithoutProperties(_ref, ["queue", "models", "queueFile", "withViews", "onWillOpen", "onBeforeMigrations", "onDidOpen"]);

    super(); // Prevent node warning about more than 11 listeners
    // Each model has 2 instances that might listen

    _defineProperty(this, "MAX_RETRY", 38);

    _defineProperty(this, "_waitingP", null);

    _defineProperty(this, "_minVersion", 0);

    _defineProperty(this, "_getVersionP", null);

    _defineProperty(this, "_waitingFor", {});

    _defineProperty(this, "_maxWaitingFor", 0);

    _defineProperty(this, "_waitForEvent", async () => {
      /* eslint-disable no-await-in-loop */
      const {
        rwDb
      } = this;
      let lastV = 0;
      let errorCount = 0;
      if (dbg.enabled && this._minVersion) dbg(`waiting for events until minVersion: ${this._minVersion}`);

      while (!this._minVersion || this._minVersion > lastV) {
        if (errorCount) {
          if (errorCount > this.MAX_RETRY) throw new Error(`Giving up on processing event ${lastV + 1}`); // These will reopen automatically

          await Promise.all([this.db.file !== ':memory:' && this.db.close(), this.rwDb.file !== ':memory:' && this.rwDb.close(), this.queue.db.file !== ':memory:' && this.queue.db.close()]);
          await wait(5000 * errorCount);
        }

        let event;

        try {
          event = await this.queue.getNext((await this.getVersion()), !(this._isPolling || this._minVersion));
        } catch (error) {
          errorCount++; // eslint-disable-next-line no-console

          console.error(`!!! ESDB: queue.getNext failed - this should not happen`, error);
          continue;
        }

        if (!event) return lastV;
        const resultEvent = await rwDb.withTransaction(async () => {
          lastV = event.v; // It could be that it was processed elsewhere due to racing

          const nowV = await this.getVersion();
          if (event.v <= nowV) return;
          await rwDb.run('SAVEPOINT handle');
          const result = await this._handleEvent(event);

          if (result.error) {
            // Undo all changes, but retain the event info
            await rwDb.run('ROLLBACK TO SAVEPOINT handle');

            if (result.result) {
              result.failedResult = result.result;
              delete result.result;
            }
          } else {
            await rwDb.run('RELEASE SAVEPOINT handle');
          }

          return this._resultQueue.set(result);
        }).catch(error => {
          if (!this.__BE_QUIET) // eslint-disable-next-line no-console
            console.error('!!! ESDB: an error occured outside of the normal error handlers', error);
          return _objectSpread({}, event, {
            error: {
              _SQLite: errorToString(error)
            }
          });
        });
        if (!resultEvent) continue; // Another process handled the event

        if (resultEvent.error) {
          errorCount++;

          if (!this.__BE_QUIET) {
            let path, error; // find the deepest error

            const walkEvents = (ev, p = ev.type) => {
              if (ev.events) {
                let i = 0;

                for (const sub of ev.events) if (walkEvents(sub, `${p}.${i++}:${sub.type}`)) return true;
              }

              if (ev.error) {
                path = p;
                error = ev.error;
                return true;
              }

              return false;
            };

            walkEvents(resultEvent); // eslint-disable-next-line no-console

            console.error(`!!! ESDB: event ${path} processing failed (try #${errorCount})`, error);
          } // eslint-disable-next-line require-atomic-updates


          lastV = resultEvent.v - 1;
        } else errorCount = 0;

        this._triggerEventListeners(resultEvent);

        if (this._reallyStop || errorCount && process.env.NODE_ENV === 'test') {
          this._reallyStop = false;
          return;
        }
      }

      return lastV;
      /* eslint-enable no-await-in-loop */
    });

    this.setMaxListeners(Object.keys(models).length * 2 + 20);
    if (dbOptions.db) throw new TypeError('db is no longer an option, pass the db options instead, e.g. file, verbose, readOnly');
    if (!models) throw new TypeError('models are required');
    if (queueFile && queue) throw new TypeError('Either pass queue or queueFile');
    this.rwDb = new _DB.default(_objectSpread({}, dbOptions, {
      onWillOpen,
      onBeforeMigrations: async db => {
        // hacky side-channel to get current version to queue without deadlocks
        this._knownV = await db.userVersion();
        if (prevOBM) await prevOBM();
      },
      onDidOpen: async db => {
        // let's hope nobody added events to the queue with the wrong version
        const {
          _knownV
        } = this;

        if (_knownV) {
          this._knownV = null;
          await this.queue.setKnownV(_knownV);
        }

        if (prevODO) await prevODO(db);
      }
    }));
    const {
      readOnly
    } = this.rwDb; // The RO DB needs to be the same for :memory: or it won't see anything

    this.db = this.rwDb.file === ':memory:' || readOnly ? this.rwDb : new _DB.default(_objectSpread({}, dbOptions, {
      name: dbOptions.name && `RO-${dbOptions.name}`,
      readOnly: true,
      onWillOpen: async () => {
        // Make sure migrations happened before opening
        await this.rwDb.open();
      }
    }));

    if (queue) {
      this.queue = queue;
    } else {
      const qDb = new _DB.default(_objectSpread({}, dbOptions, {
        name: `${dbOptions.name || ''}Queue`,
        file: queueFile || this.rwDb.file,
        onDidOpen: async () => {
          // let's hope nobody added events to the queue with the wrong version
          const {
            _knownV
          } = this;

          if (_knownV) {
            this._knownV = null;
            await this.queue.setKnownV(_knownV);
          }
        }
      }));
      this.queue = new _EventQueue.default({
        db: qDb,
        withViews,
        columns: {
          events: {
            type: 'JSON'
          }
        }
      });
    }

    const qDbFile = this.queue.db.file; // If queue is in same file as rwDb, share the connection
    // for writing results during transaction - no deadlocks

    this._resultQueue = this.rwDb.file === qDbFile && qDbFile !== ':memory:' ? new _EventQueue.default({
      db: this.rwDb
    }) : this.queue; // Move old history data to queue DB

    if (this.rwDb.file !== qDbFile) {
      registerHistoryMigration(this.rwDb, this.queue);
    }

    this.rwDb.registerMigrations('ESDB', {
      // Move v2 metadata version to DB user_version
      userVersion: async db => {
        const uv = await db.userVersion();
        if (uv) return; // Somehow we already have a version

        const hasMetadata = await db.get('SELECT 1 FROM sqlite_master WHERE name="metadata"');
        if (!hasMetadata) return;
        const vObj = await db.get('SELECT json_extract(json, "$.v") AS v FROM metadata WHERE id="version"');
        const v = vObj && Number(vObj.v);
        if (!v) return;
        await db.userVersion(v);
        const {
          count
        } = await db.get(`SELECT count(*) AS count from metadata`);

        if (count === 1) {
          await db.exec(`DROP TABLE metadata; DELETE FROM _migrations WHERE runKey="0 metadata"`).catch(() => {
            /* shrug */
          });
        } else {
          await db.run(`DELETE FROM metadata WHERE id="version"`);
        }
      }
    });
    this.store = {};
    this.rwStore = {};
    this._reducerNames = [];
    this._deriverModels = [];
    this._preprocModels = [];
    this._readWriters = [];
    const reducers = {};
    const migrationOptions = {
      queue: this.queue
    };
    const dispatch = this.dispatch.bind(this);

    for (const [name, modelDef] of Object.entries(models)) {
      try {
        if (!modelDef) throw new Error('model missing');

        let {
          reducer,
          preprocessor,
          deriver,
          Model = _ESModel.default,
          RWModel = Model
        } = modelDef,
            rest = _objectWithoutProperties(modelDef, ["reducer", "preprocessor", "deriver", "Model", "RWModel"]);

        if (RWModel === _ESModel.default) {
          if (reducer) {
            const prev = fixupOldReducer(name, reducer);

            reducer = async args => {
              const result = await prev(args);
              if (!result && args.event.type === model.TYPE) return _ESModel.default.reducer(args);
              return result;
            };
          }

          if (preprocessor) {
            const prev = preprocessor;

            preprocessor = async args => {
              const e = await _ESModel.default.preprocessor(args); // eslint-disable-next-line require-atomic-updates

              if (e) args.event = e;
              return prev(args);
            };
          }
        }

        let hasOne = false;
        const rwModel = this.rwDb.addModel(RWModel, _objectSpread({
          name
        }, rest, {
          migrationOptions,
          dispatch,
          emitter: this
        }));
        rwModel.deriver = deriver || RWModel.deriver;
        this.rwStore[name] = rwModel;
        if (typeof rwModel.setWritable === 'function') this._readWriters.push(rwModel);

        if (rwModel.deriver) {
          this._deriverModels.push(rwModel);

          hasOne = true;
        }

        let model;

        if (this.db === this.rwDb) {
          model = rwModel;
        } else {
          model = this.db.addModel(Model, _objectSpread({
            name
          }, rest, {
            dispatch,
            emitter: this
          }));
        }

        model.preprocessor = preprocessor || Model.preprocessor;
        model.reducer = fixupOldReducer(name, reducer || Model.reducer);
        this.store[name] = model;

        if (model.preprocessor) {
          this._preprocModels.push(model);

          hasOne = true;
        }

        if (model.reducer) {
          this._reducerNames.push(name);

          reducers[name] = model.reducer;
          hasOne = true;
        }

        if (!hasOne) throw new TypeError(`${this.name}: At least one reducer, deriver or preprocessor required`);
      } catch (error) {
        if (error.message) error.message = `ESDB: while configuring model ${name}: ${error.message}`;
        if (error.stack) error.stack = `ESDB: while configuring model ${name}: ${error.stack}`;
        throw error;
      }
    }
  }

  open() {
    return this.db.open();
  }

  async close() {
    await this.stopPolling();
    return Promise.all([this.rwDb && this.rwDb.close(), this.db !== this.rwDb && this.db.close(), this.queue.db.close()]);
  }

  async checkForEvents() {
    const [v, qV] = await Promise.all([this.getVersion(), this.queue.getMaxV()]);
    if (v < qV) return this.startPolling(qV);
  }

  async waitForQueue() {
    // give migrations a chance to queue things
    await this.rwDb.open();
    const v = await this.queue.getMaxV();
    return this.handledVersion(v);
  }

  startPolling(wantVersion) {
    if (wantVersion) {
      if (wantVersion > this._minVersion) this._minVersion = wantVersion;
    } else if (!this._isPolling) {
      this._isPolling = true;

      if (module.hot) {
        module.hot.dispose(() => {
          this.stopPolling();
        });
      }
    }

    if (!this._waitingP) {
      this._waitingP = this._waitForEvent().catch(error => {
        // eslint-disable-next-line no-console
        console.error('!!! Error waiting for event! This should not happen! Please investigate!', error); // Crash program but leave some time to notify

        if (process.env.NODE_ENV !== 'test') // eslint-disable-next-line unicorn/no-process-exit
          setTimeout(() => process.exit(100), 500);
        throw new Error(error);
      }).then(lastV => {
        this._waitingP = null; // Subtle race condition: new wantVersion coming in between end of _wait and .then
        // lastV is falsy when forcing a stop

        if (lastV != null && this._minVersion && lastV < this._minVersion) return this.startPolling(this._minVersion);
        this._minVersion = 0;
        return undefined;
      });
    }

    return this._waitingP;
  }

  stopPolling() {
    this._isPolling = false;
    this._reallyStop = true;
    this.queue.cancelNext();
    return this._waitingP || Promise.resolve();
  }

  async dispatch(type, data, ts) {
    const {
      _knownV
    } = this;

    if (_knownV) {
      this._knownV = null;
      await this.queue.setKnownV(_knownV);
    }

    const event = await this.queue.add(type, data, ts);
    return this.handledVersion(event.v);
  }

  _subDispatch(event, type, data) {
    if (!event.events) event.events = [];
    event.events.push({
      type,
      data
    });
    dbg(`${event.type}.${type} queued`);
  }

  getVersion() {
    if (!this._getVersionP) {
      this._getVersionP = this.db.userVersion().finally(() => {
        this._getVersionP = null;
      });
    }

    return this._getVersionP;
  }

  async handledVersion(v) {
    if (!v) return; // We must get the version first because our history might contain future events

    if (v <= (await this.getVersion())) {
      const event = await this.queue.get(v); // The event could be missing if pruned

      if (event === null || event === void 0 ? void 0 : event.error) {
        // This can only happen if we skipped a failed event
        return Promise.reject(event);
      }

      return event;
    }

    if (!this._waitingFor[v]) {
      if (v > this._maxWaitingFor) this._maxWaitingFor = v;
      const o = {};
      this._waitingFor[v] = o;
      o.promise = new Promise((resolve, reject) => {
        o.resolve = resolve;
        o.reject = reject;
      });
      this.startPolling(v);
    }

    return this._waitingFor[v].promise;
  }

  _triggerEventListeners(event) {
    const o = this._waitingFor[event.v];
    if (o) delete this._waitingFor[event.v];

    if (event.v >= this._maxWaitingFor) {
      // Normally this will be empty but we might encounter a race condition
      for (const vStr of Object.keys(this._waitingFor)) {
        const v = Number(vStr);
        if (v > event.v) continue; // Note: if the DB fails for get(), the trigger won't run and it will retry later
        // eslint-disable-next-line promise/catch-or-return

        this.queue.get(v).then(event => this._triggerEventListeners(event));
      }
    } // Note that error events don't increase the DB version


    if (event.error) {
      // emit 'error' throws if there is no listener
      if (this.listenerCount('error')) {
        try {
          this.emit('error', event);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('!!! "error" event handler threw, ignoring', error);
        }
      }

      if (o && process.env.NODE_ENV === 'test') {
        if (!this.__BE_QUIET) // eslint-disable-next-line no-console
          console.error(`!!! rejecting the dispatch for event ${event.v} ${event.type} - this does NOT happen outside test mode, NEVER rely on this.
						Set eSDB.__BE_QUIET to not show this message`);
        o.reject(event);
      }
    } else {
      try {
        this.emit('result', event);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('!!! "result" event handler threw, ignoring', error);
      }

      if (o) o.resolve(event);
    }
  } // This is the loop that applies events from the queue. Use startPolling(false) to always poll
  // so that events from other processes are also handled
  // It would be nice to not have to poll, but sqlite triggers only work on
  // the connection that makes the change
  // This should never throw, handling errors can be done in apply


  async _preprocessor(event, isMainEvent) {
    for (const model of this._preprocModels) {
      const {
        name
      } = model;
      const {
        v,
        type
      } = event;
      let newEvent;

      try {
        // eslint-disable-next-line no-await-in-loop
        newEvent = await model.preprocessor({
          event,
          // subevents must see intermediate state
          model: isMainEvent ? model : this.rwStore[name],
          store: isMainEvent ? this.store : this.rwStore,
          dispatch: this._subDispatch.bind(this, event),
          isMainEvent
        });
      } catch (error) {
        newEvent = {
          error
        };
      } // mutation allowed


      if (!newEvent) newEvent = event;

      if (!newEvent.error) {
        // Just in case event was mutated
        if (newEvent.v !== v) newEvent.error = new Error(`preprocessor must retain event version`);else if (!newEvent.type) newEvent.error = new Error(`preprocessor must retain event type`);
      }

      if (newEvent.error) {
        return _objectSpread({}, event, {
          v,
          type,
          error: {
            [`_preprocess_${name}`]: errorToString(newEvent.error)
          }
        });
      } // allow other preprocessors to alter the event


      event = newEvent;
    }

    return event;
  }

  async _reducer(event, isMainEvent) {
    const result = {};
    const events = event.events || [];

    if (_warning.DEV) {
      Object.freeze(event.data);
    }

    await Promise.all(this._reducerNames.map(async name => {
      const model = this.store[name];
      const helpers = {
        event,
        // subevents must see intermediate state
        model: isMainEvent ? model : this.rwStore[name],
        store: isMainEvent ? this.store : this.rwStore,
        dispatch: this._subDispatch.bind(this, event),
        isMainEvent
      };
      let out;

      try {
        out = await model.reducer(helpers);
      } catch (error) {
        out = {
          error: errorToString(error)
        };
      } // in <v3 we allowed returning the model to indicate no change


      if (!out || out === model) return;

      if (out.events) {
        if (!Array.isArray(out.events)) {
          result[name] = {
            error: `.events is not an array`
          };
          return;
        }

        events.push(...out.events);
        delete out.events;
      } else if ('events' in out) {
        // allow falsy events
        delete out.events;
      }

      result[name] = out;
    }));

    if (this._reducerNames.some(n => result[n] && result[n].error)) {
      const error = {};

      for (const name of this._reducerNames) {
        const r = result[name];

        if (r && r.error) {
          error[`_reduce_${name}`] = r.error;
        }
      }

      return _objectSpread({}, event, {
        error
      });
    }

    const resultEvent = _objectSpread({}, event, {
      result
    });

    if (events.length) resultEvent.events = events;
    return resultEvent;
  }

  async _handleEvent(origEvent, depth = 0) {
    const isMainEvent = depth === 0;
    let event;

    if (depth > 100) {
      return _objectSpread({}, origEvent, {
        error: {
          _handle: `.${origEvent.type}: events recursing too deep`
        }
      });
    }

    dbg(`handling ${origEvent.v} ${'>'.repeat(depth)}${origEvent.type}`);
    event = _objectSpread({}, origEvent, {
      result: undefined,
      events: undefined,
      error: undefined
    });
    event = await this._preprocessor(event, isMainEvent);
    if (event.error) return event;
    event = await this._reducer(event, isMainEvent);
    if (event.error) return event;
    event = await this._applyEvent(event, isMainEvent);
    if (event.error) return event; // handle sub-events in order

    if (event.events) {
      for (let i = 0; i < event.events.length; i++) {
        const subEvent = event.events[i]; // eslint-disable-next-line no-await-in-loop

        const doneEvent = await this._handleEvent(_objectSpread({}, subEvent, {
          v: event.v
        }), depth + 1);
        delete doneEvent.v;
        event.events[i] = doneEvent;
        const {
          error
        } = doneEvent;

        if (error) {
          if (depth && error._handle) // pass the error upwards but leave on bottom-most
            delete doneEvent.error;
          event.error = {
            _handle: `.${subEvent.type}${error._handle ? error._handle : ` failed`}`
          };
          return event;
        }
      }
    }

    return event;
  }

  async _applyEvent(event, isMainEvent) {
    const {
      rwStore,
      rwDb,
      _readWriters: readWriters
    } = this;
    let phase = '???';

    try {
      for (const model of readWriters) model.setWritable(true);

      const {
        result
      } = event;

      if (result && !(0, _isEmpty2.default)(result)) {
        phase = 'apply'; // Apply reducer results, wait for all to settle

        await (0, _settleAll.settleAll)(Object.entries(result), async ([name, r]) => r && rwStore[name].applyResult(r));
      }

      if (isMainEvent) {
        phase = 'version';
        await rwDb.userVersion(event.v);
      } // Apply derivers


      if (!event.error && this._deriverModels.length) {
        phase = 'derive';
        await (0, _settleAll.settleAll)(this._deriverModels, async model => model.deriver({
          event,
          model,
          // derivers can write anywhere (carefully)
          store: this.rwStore,
          dispatch: this._subDispatch.bind(this, event),
          isMainEvent,
          result: result[model.name]
        }));
      }
    } catch (error) {
      if (event.result) {
        // eslint-disable-next-line require-atomic-updates
        event.failedResult = event.result;
        delete event.result;
      } // eslint-disable-next-line require-atomic-updates


      if (!event.error) event.error = {}; // eslint-disable-next-line require-atomic-updates

      event.error[`_apply_${phase}`] = errorToString(error);
    } finally {
      for (const model of readWriters) model.setWritable(false);
    }

    return event;
  }

}

var _default = EventSourcingDB;
exports.default = _default;
//# sourceMappingURL=EventSourcingDB.js.map