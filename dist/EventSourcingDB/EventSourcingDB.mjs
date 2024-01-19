var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { AsyncLocalStorage } from "node:async_hooks";
import EventEmitter from "node:events";
import debug from "debug";
import { isEmpty } from "lodash";
import DBImpl from "../DB/DB.mjs";
import "../DB/SQLite.mjs";
import ESModel from "./ESModel.mjs";
import EventQueueImpl from "../EventQueue.mjs";
import { settleAll } from "../lib/settleAll.mjs";
import { DEV, deprecated } from "../lib/warning.mjs";
const dbg = debug("strato-db/ESDB");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hasUndefValue = (obj) => {
  if (typeof obj === "undefined")
    return true;
  if (!obj)
    return false;
  if (Array.isArray(obj))
    return obj.some(hasUndefValue);
  if (typeof obj === "object")
    return Object.values(obj).some(hasUndefValue);
  return false;
};
const registerHistoryMigration = (rwDb, queue) => {
  rwDb.registerMigrations("historyExport", {
    2018040800: {
      up: async (db) => {
        const oldTable = await db.all("PRAGMA table_info(history)");
        if (!(oldTable.length === 4 && oldTable.some((c) => c.name === "json") && oldTable.some((c) => c.name === "v") && oldTable.some((c) => c.name === "type") && oldTable.some((c) => c.name === "ts")))
          return;
        let allDone = Promise.resolve();
        await db.each("SELECT * from history", (row) => {
          allDone = allDone.then(
            () => queue.set({ ...row, json: void 0, ...JSON.parse(row.json) })
          );
        });
        await allDone;
        console.error(`!!! history table in ${rwDb.file} is no longer needed`);
      }
    }
  });
};
const errorToString = (error) => {
  const msg = error ? error.stack || error.message || String(error) : new Error("missing error").stack;
  return String(msg).replaceAll(/\s+/g, " ");
};
const fixupOldReducer = (name, reducer) => {
  if (!reducer)
    return;
  if (reducer.length !== 1) {
    if (DEV)
      if (reducer.length === 0) {
        deprecated(
          "varargsReducer",
          `${name}: reducer has a single argument now, don't use ...args`
        );
      } else {
        deprecated(
          "oldReducer",
          `${name}: reducer has a single argument now, like preprocessor/deriver`
        );
      }
    const prev = reducer;
    reducer = (args) => prev(args.model, args.event, args);
  }
  return reducer;
};
const makeDispatcher = (name, fn) => (typeOrEvent, data, ts) => {
  let type;
  if (typeof typeOrEvent === "string") {
    type = typeOrEvent;
  } else {
    if (DEV) {
      if (data)
        throw new Error(
          `${name}: second argument must not be defined when passing the event as an object`
        );
      const { type: _1, data: _2, ts: _3, ...rest } = typeOrEvent;
      if (Object.keys(rest).length)
        throw new Error(`${name}: extra key(s) ${Object.keys(rest).join(",")}`);
    }
    data = typeOrEvent.data;
    ts = typeOrEvent.ts;
    type = typeOrEvent.type;
  }
  if (!type || typeof type !== "string")
    throw new Error(`${name}: type is a required string`);
  return fn(type, data, ts);
};
class EventSourcingDB extends EventEmitter {
  // this is an hour
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
    super();
    __publicField(this, "MAX_RETRY", 38);
    /** @type {Promise<void> | null} */
    __publicField(this, "_waitingP", null);
    __publicField(this, "_minVersion", 0);
    /**
     * @param {string | {type: string; data?: any; ts?: number}} typeOrEvent
     * Event type or the entire event.
     * @param {any} [data]
     * Event data, can be anything.
     * @param {number} [ts]
     * The timestamp of the event.
     * @returns {Promise<Event>} The processed event.
     */
    __publicField(this, "dispatch", makeDispatcher("dispatch", async (type, data, ts) => {
      const event = await this.queue.add(type, data, ts);
      return this.handledVersion(event.v);
    }));
    __publicField(this, "_makeAddSubEvent", (event) => makeDispatcher("addEvent", (type, data) => {
      event.events || (event.events = []);
      event.events.push({ type, data });
      dbg(`${event.type}.${type} queued`);
    }));
    /** @type {Promise<number> | null} */
    __publicField(this, "_getVersionP", null);
    __publicField(this, "_waitingFor", {});
    __publicField(this, "_maxWaitingFor", 0);
    __publicField(this, "_processing", false);
    // This is the loop that applies events from the queue. Use startPolling(false) to always poll
    // so that events from other processes are also handled
    // It would be nice to not have to poll, but sqlite triggers only work on
    // the connection that makes the change
    // This should never throw, handling errors can be done in apply
    __publicField(this, "_waitForEvent", async () => {
      const { db, rwDb, queue, _resultQueue } = this;
      let lastV = 0;
      let errorCount = 0;
      if (dbg.enabled && this._minVersion)
        dbg(`waiting for events until minVersion: ${this._minVersion}`);
      while (!this._minVersion || this._minVersion > lastV) {
        if (errorCount) {
          if (errorCount > this.MAX_RETRY)
            throw new Error(`Giving up on processing event ${lastV + 1}`);
          await Promise.all([
            db.file !== ":memory:" && db.close(),
            rwDb.file !== ":memory:" && rwDb.close(),
            queue.db.file !== ":memory:" && queue.db.close()
          ]);
          await wait(5e3 * errorCount);
        }
        let event;
        try {
          event = await queue.getNext(
            await this.getVersion(),
            !(this._isPolling || this._minVersion)
          );
        } catch (error) {
          errorCount++;
          console.error(
            `!!! ESDB: queue.getNext failed - this should not happen`,
            error
          );
          continue;
        }
        if (!event)
          return lastV;
        const resultEvent = await rwDb.withTransaction(async () => {
          this._processing = true;
          lastV = event.v;
          const nowV = await this.getVersion();
          if (event.v <= nowV)
            return;
          await rwDb.run("SAVEPOINT handle");
          const result = await this._alsDispatch.run(
            {},
            this._handleEvent,
            event
          );
          if (result.error) {
            await rwDb.run("ROLLBACK TO SAVEPOINT handle");
            if (result.result) {
              result.failedResult = result.result;
              delete result.result;
            }
          } else {
            await rwDb.run("RELEASE SAVEPOINT handle");
          }
          return _resultQueue.set(result);
        }).catch((error) => {
          if (!this.__BE_QUIET)
            console.error(
              "!!! ESDB: an error occured outside of the normal error handlers",
              error
            );
          return {
            ...event,
            error: { _SQLite: errorToString(error) }
          };
        }).finally(() => {
          this._processing = false;
        });
        if (!resultEvent)
          continue;
        if (resultEvent.error) {
          errorCount++;
          if (!this.__BE_QUIET) {
            let path, error;
            const walkEvents = (ev, p = ev.type) => {
              if (ev.events) {
                let i = 0;
                for (const sub of ev.events)
                  if (walkEvents(sub, `${p}.${i++}:${sub.type}`))
                    return true;
              }
              if (ev.error) {
                path = p;
                error = ev.error;
                return true;
              }
              return false;
            };
            walkEvents(resultEvent);
            console.error(
              `!!! ESDB: event ${resultEvent.v} ${path} processing failed (try #${errorCount})`,
              error
            );
          }
          lastV = resultEvent.v - 1;
        } else {
          errorCount = 0;
          if (db !== rwDb) {
            let roV;
            do {
              roV = await db.userVersion();
            } while (roV < event.v);
          }
        }
        this._triggerEventListeners(resultEvent);
        if (this._reallyStop || errorCount && process.env.NODE_ENV === "test") {
          this._reallyStop = false;
          return;
        }
      }
      return lastV;
    });
    __publicField(this, "_handleEvent", async (origEvent, depth = 0) => {
      const isMainEvent = depth === 0;
      let event;
      if (depth > 100) {
        return {
          ...origEvent,
          error: {
            _handle: `.${origEvent.type}: events recursing too deep`
          }
        };
      }
      dbg(`handling ${origEvent.v} ${">".repeat(depth)}${origEvent.type}`);
      event = {
        ...origEvent,
        result: void 0,
        events: void 0,
        error: void 0
      };
      let cache = {};
      event = await this._preprocessor(cache, event, isMainEvent);
      if (event.error)
        return event;
      event = await this._reducer(cache, event, isMainEvent);
      if (event.error)
        return event;
      cache = null;
      event = await this._applyEvent(event, isMainEvent);
      if (event.error)
        return event;
      const events = event.events || [];
      const handleSubEvent = async (subEvent) => {
        const doneEvent = await this._handleEvent(
          { ...subEvent, v: event.v },
          depth + 1
        );
        delete doneEvent.v;
        const { error } = doneEvent;
        if (error) {
          if (depth && error._handle)
            delete doneEvent.error;
          event.error = {
            _handle: `.${subEvent.type}${error._handle || ` failed`}`
          };
        }
        return doneEvent;
      };
      for (let i = 0; i < events.length; i++) {
        events[i] = await handleSubEvent(events[i]);
        if (event.error)
          return event;
      }
      let lastP = null;
      const dispatch = makeDispatcher("dispatch", async (type, data) => {
        const subEventP = this._alsDispatch.run({}, handleSubEvent, {
          type,
          data
        });
        lastP = lastP ? lastP.then(() => subEventP) : subEventP;
        const subEvent = await lastP;
        events.push(subEvent);
        if (event.error)
          throw new Error(`Event ${event.v} errored: ${event.error._handle}`);
        return subEvent;
      });
      event = await this._alsDispatch.run(
        { dispatch },
        () => this._transact(event, isMainEvent, dispatch)
      );
      if (events.length)
        event.events = events;
      return event;
    });
    if (dbOptions.db)
      throw new TypeError(
        "db is no longer an option, pass the db options instead, e.g. file, verbose, readOnly"
      );
    if (!models)
      throw new TypeError("models are required");
    if (queueFile && queue)
      throw new TypeError("Either pass queue or queueFile");
    this.rwDb = new DBImpl({
      ...dbOptions,
      onWillOpen,
      onBeforeMigrations: async (db) => {
        const v = await db.userVersion();
        if (v)
          this.queue.setKnownV(v);
        if (prevOBM)
          await prevOBM();
      },
      onDidOpen
    });
    const { readOnly } = this.rwDb;
    this.db = this.rwDb.file === ":memory:" || readOnly ? this.rwDb : new DBImpl({
      ...dbOptions,
      name: dbOptions.name && `RO-${dbOptions.name}`,
      readOnly: true,
      onWillOpen: async () => {
        await this.rwDb.open();
      }
    });
    if (queue) {
      this.queue = queue;
    } else {
      const qDb = new DBImpl({
        ...dbOptions,
        name: `${dbOptions.name || ""}Queue`,
        file: queueFile || this.rwDb.file
      });
      this.queue = new EventQueueImpl({
        db: qDb,
        withViews,
        columns: { events: { type: "JSON" } }
      });
    }
    const qDbFile = this.queue.db.file;
    this._resultQueue = this.rwDb.file === qDbFile && qDbFile !== ":memory:" ? new EventQueueImpl({ db: this.rwDb }) : this.queue;
    if (this.rwDb.file !== qDbFile) {
      registerHistoryMigration(this.rwDb, this.queue);
    }
    this.rwDb.registerMigrations("ESDB", {
      // Move v2 metadata version to DB user_version
      userVersion: async (db) => {
        const uv = await db.userVersion();
        if (uv)
          return;
        const hasMetadata = await db.get(
          'SELECT 1 FROM sqlite_master WHERE name="metadata"'
        );
        if (!hasMetadata)
          return;
        const vObj = await db.get(
          'SELECT json_extract(json, "$.v") AS v FROM metadata WHERE id="version"'
        );
        const v = vObj && Number(vObj.v);
        if (!v)
          return;
        await db.userVersion(v);
        const { count } = await db.get(`SELECT count(*) AS count from metadata`);
        await (count === 1 ? db.exec(
          `DROP TABLE metadata; DELETE FROM _migrations WHERE runKey="0 metadata"`
        ).catch(() => {
        }) : db.run(`DELETE FROM metadata WHERE id="version"`));
      }
    });
    this.store = {};
    this.rwStore = {};
    this._alsDispatch = new AsyncLocalStorage();
    this._preprocModels = [];
    this._reducerNames = [];
    this._deriverModels = [];
    this._transactModels = [];
    this._readWriters = [];
    const reducers = {};
    const migrationOptions = { queue: this.queue };
    const dispatch = async (type, data, ts) => {
      if (this._processing) {
        const store = this._alsDispatch.getStore();
        dbg({ store });
        if (store) {
          if (!store.dispatch) {
            throw new Error(`Dispatching is only allowed in transact phase`);
          }
          return store.dispatch(type, data);
        }
      }
      return this.dispatch(type, data, ts);
    };
    for (const [name, modelDef] of Object.entries(models)) {
      try {
        if (!modelDef)
          throw new Error("model missing");
        let {
          reducer,
          preprocessor,
          deriver,
          transact,
          Model = ESModel,
          RWModel = Model,
          ...rest
        } = modelDef;
        if (RWModel === ESModel) {
          if (reducer) {
            const prev = fixupOldReducer(name, reducer);
            reducer = async (args) => {
              const result = await prev(args);
              if (!result && args.event.type === model.TYPE)
                return ESModel.reducer(args);
              return result;
            };
          }
          if (preprocessor) {
            const prev = preprocessor;
            preprocessor = async (args) => {
              const e = await ESModel.preprocessor(args);
              if (e)
                args.event = e;
              return prev(args);
            };
          }
        }
        let hasOne = false;
        const rwModel = this.rwDb.addModel(RWModel, {
          name,
          ...rest,
          migrationOptions,
          dispatch,
          emitter: this
        });
        rwModel.deriver = deriver || RWModel.deriver;
        this.rwStore[name] = rwModel;
        if (typeof rwModel.setWritable === "function")
          this._readWriters.push(rwModel);
        if (rwModel.deriver) {
          this._deriverModels.push(rwModel);
          hasOne = true;
        }
        const model = this.db === this.rwDb ? rwModel : this.db.addModel(Model, {
          name,
          ...rest,
          dispatch,
          emitter: this
        });
        model.preprocessor = preprocessor || Model.preprocessor;
        model.reducer = fixupOldReducer(name, reducer || Model.reducer);
        if (!model.transact)
          model.transact = transact || Model.transact;
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
        if (model.transact) {
          this._transactModels.push(model);
          hasOne = true;
        }
        if (!hasOne)
          throw new TypeError(
            `${name}: At least one reducer, deriver or preprocessor required`
          );
      } catch (error) {
        if (error.message)
          error.message = `ESDB: while configuring model ${name}: ${error.message}`;
        if (error.stack)
          error.stack = `ESDB: while configuring model ${name}: ${error.stack}`;
        throw error;
      }
    }
  }
  open() {
    return this.db.open();
  }
  async close() {
    await this.stopPolling();
    return Promise.all([
      this.rwDb && this.rwDb.close(),
      this.db !== this.rwDb && this.db.close(),
      this.queue.db.close()
    ]);
  }
  async checkForEvents() {
    const [v, qV] = await Promise.all([this.getVersion(), this.queue.getMaxV()]);
    if (v < qV)
      return this.startPolling(qV);
  }
  async waitForQueue() {
    await this.rwDb.open();
    const v = await this.queue.getMaxV();
    return this.handledVersion(v);
  }
  startPolling(wantVersion) {
    if (wantVersion) {
      if (wantVersion > this._minVersion)
        this._minVersion = wantVersion;
    } else if (!this._isPolling) {
      this._isPolling = true;
      if (module.hot) {
        module.hot.dispose(() => {
          this.stopPolling();
        });
      }
    }
    if (!this._waitingP) {
      this._waitingP = this._waitForEvent().catch((error) => {
        console.error(
          "!!! Error waiting for event! This should not happen! Please investigate!",
          error
        );
        if (process.env.NODE_ENV !== "test")
          setTimeout(() => process.exit(100), 500);
        throw new Error(error);
      }).then((lastV) => {
        this._waitingP = null;
        if (lastV != null && this._minVersion && lastV < this._minVersion)
          return this.startPolling(this._minVersion);
        this._minVersion = 0;
        return void 0;
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
  getVersion() {
    if (!this._getVersionP) {
      this._getVersionP = this.db.userVersion().finally(() => {
        this._getVersionP = null;
      });
    }
    return this._getVersionP;
  }
  async handledVersion(v) {
    if (!v)
      return;
    if (v <= await this.getVersion()) {
      const event = await this.queue.get(v);
      if (event?.error) {
        throw event;
      }
      return event;
    }
    if (!this._waitingFor[v]) {
      if (v > this._maxWaitingFor)
        this._maxWaitingFor = v;
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
    if (o)
      delete this._waitingFor[event.v];
    if (event.v >= this._maxWaitingFor) {
      for (const vStr of Object.keys(this._waitingFor)) {
        const prevV = Number(vStr);
        if (prevV > event.v)
          continue;
        this.queue.get(prevV).then((prevEvent) => this._triggerEventListeners(prevEvent));
      }
    }
    if (event.error) {
      if (this.listenerCount("error")) {
        try {
          this.emit("error", event);
        } catch (error) {
          console.error('!!! "error" event handler threw, ignoring', error);
        }
      }
      if (o && process.env.NODE_ENV === "test") {
        if (!this.__BE_QUIET)
          console.error(
            `!!! rejecting the dispatch for event ${event.v} ${event.type} - this does NOT happen outside test mode, NEVER rely on this.
						Set eSDB.__BE_QUIET to not show this message`
          );
        o.reject(event);
      }
    } else {
      try {
        this.emit("result", event);
      } catch (error) {
        console.error('!!! "result" event handler threw, ignoring', error);
      }
      if (o)
        o.resolve(event);
    }
  }
  async _preprocessor(cache, event, isMainEvent) {
    const addEvent = this._makeAddSubEvent(event);
    const dispatch = (...args) => {
      deprecated("addEvent preprocessor", "use .addEvent instead of .dispatch");
      return addEvent(...args);
    };
    for (const model of this._preprocModels) {
      const { name } = model;
      const { v, type } = event;
      let newEvent;
      try {
        newEvent = await model.preprocessor({
          cache,
          event,
          // subevents must see intermediate state
          model: isMainEvent ? model : this.rwStore[name],
          store: isMainEvent ? this.store : this.rwStore,
          addEvent,
          dispatch,
          isMainEvent
        });
      } catch (error) {
        newEvent = { error };
      }
      if (!newEvent)
        newEvent = event;
      if (!newEvent.error) {
        if (newEvent.v !== v)
          newEvent.error = new Error(`preprocessor must retain event version`);
        else if (!newEvent.type)
          newEvent.error = new Error(`preprocessor must retain event type`);
      }
      if (newEvent.error) {
        return {
          ...event,
          v,
          type,
          error: {
            [`_preprocess_${name}`]: errorToString(newEvent.error)
          }
        };
      }
      event = newEvent;
    }
    return event;
  }
  async _reducer(cache, event, isMainEvent) {
    const result = {};
    if (DEV) {
      Object.freeze(event.data);
    }
    await Promise.all(
      this._reducerNames.map(async (name) => {
        const model = this.store[name];
        const addEvent = this._makeAddSubEvent(event);
        const dispatch = (...args) => {
          deprecated("addEvent", "use .addEvent instead of .dispatch");
          return addEvent(...args);
        };
        const helpers = {
          cache,
          event,
          // subevents must see intermediate state
          model: isMainEvent ? model : this.rwStore[name],
          store: isMainEvent ? this.store : this.rwStore,
          dispatch,
          addEvent,
          isMainEvent
        };
        let out;
        try {
          out = await model.reducer(helpers);
        } catch (error) {
          out = {
            error: errorToString(error)
          };
        }
        if (!out || out === model)
          return;
        if (out.events) {
          if (!Array.isArray(out.events)) {
            result[name] = { error: `.events is not an array` };
            return;
          }
          if (!event.events)
            event.events = [];
          event.events.push(...out.events);
          delete out.events;
        } else if ("events" in out) {
          delete out.events;
        }
        deprecated(
          `${name}-reducer-undef`,
          `The reducer for ${name} return \`undefined\` in its result. This will no longer be allowed in v4.`,
          () => Object.values(out).some((type) => type && hasUndefValue(type))
        );
        result[name] = out;
      })
    );
    if (this._reducerNames.some((n) => result[n] && result[n].error)) {
      const error = {};
      for (const name of this._reducerNames) {
        const r = result[name];
        if (r && r.error) {
          error[`_reduce_${name}`] = r.error;
        }
      }
      return { ...event, error };
    }
    const resultEvent = {
      ...event,
      result
    };
    return resultEvent;
  }
  async _transact(event, isMainEvent, dispatch) {
    for (const model of this._transactModels) {
      const { name } = model;
      const { v, type } = event;
      try {
        await model.transact({
          event,
          // subevents must see intermediary state
          model: isMainEvent ? model : this.rwStore[name],
          store: isMainEvent ? this.store : this.rwStore,
          dispatch,
          isMainEvent
        });
      } catch (error) {
        return {
          ...event,
          v,
          type,
          error: {
            [`_transact_${name}`]: errorToString(error)
          }
        };
      }
    }
    return event;
  }
  async _applyEvent(event, isMainEvent) {
    const { rwStore, rwDb, _readWriters: readWriters, _deriverModels } = this;
    let phase = "???";
    try {
      for (const model of readWriters)
        model.setWritable(true);
      const { result } = event;
      if (result && !isEmpty(result)) {
        phase = "apply";
        await settleAll(
          Object.entries(result),
          async ([name, r]) => r && rwStore[name].applyResult(r)
        );
      }
      if (isMainEvent) {
        phase = "version";
        await rwDb.userVersion(event.v);
      }
      if (!event.error && _deriverModels.length) {
        phase = "derive";
        const addEvent = this._makeAddSubEvent(event);
        const dispatch = (...args) => {
          deprecated("addEvent deriver", "use .addEvent instead of .dispatch");
          return addEvent(...args);
        };
        await settleAll(
          this._deriverModels,
          async (model) => (
            // @ts-ignore
            model.deriver({
              event,
              model,
              // derivers can write anywhere (carefully)
              store: this.rwStore,
              addEvent,
              dispatch,
              isMainEvent,
              result: result[model.name]
            })
          )
        );
      }
    } catch (error) {
      if (event.result) {
        event.failedResult = event.result;
        delete event.result;
      }
      if (!event.error)
        event.error = {};
      event.error[`_apply_${phase}`] = errorToString(error);
    } finally {
      for (const model of readWriters)
        model.setWritable(false);
    }
    return event;
  }
}
export {
  EventSourcingDB as default
};
