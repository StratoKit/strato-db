"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const path = require("node:path");
const node_perf_hooks = require("node:perf_hooks");
const node_util = require("node:util");
const EventEmitter = require("node:events");
const debug = require("debug");
const sqlite3 = require("sqlite3");
const Statement = require("./Statement.js");
const asyncSema = require("async-sema");
const dbg = debug("strato-db/sqlite");
const dbgQ = dbg.extend("query");
const RETRY_COUNT = 10;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busyWait = () => wait(200 + Math.floor(Math.random() * 1e3));
const objToString = (o) => {
  const s = node_util.inspect(o, { compact: true, breakLength: Number.POSITIVE_INFINITY });
  return s.length > 250 ? `${s.slice(0, 250)}… (${s.length}b)` : s;
};
const quoteSqlId = (s) => `"${s.toString().replaceAll('"', '""')}"`;
const valToSql = (v) => {
  if (typeof v === "boolean")
    return v ? "1" : "0";
  if (typeof v === "number")
    return v.toString();
  if (v == null)
    return "NULL";
  return `'${v.toString().replaceAll("'", "''")}'`;
};
const isBusyError = (err) => err.code === "SQLITE_BUSY";
const sql = (tpl, ...interpolations) => {
  let out = tpl[0];
  const vars = [];
  for (let i = 1; i < tpl.length; i++) {
    const val = interpolations[i - 1];
    let str = tpl[i];
    const found = /^(ID|JSON|LIT)\b/.exec(str);
    const mod = found && found[0];
    str = mod ? str.slice(mod.length) : str;
    if (mod === "ID") {
      out += quoteSqlId(val);
    } else if (mod === "LIT") {
      out += val;
    } else {
      out += "?";
      vars.push(mod === "JSON" ? JSON.stringify(val) : val);
    }
    out += str;
  }
  return [out, vars];
};
sql.quoteId = quoteSqlId;
const argsToString = (args, isStmt) => args ? isStmt ? objToString(args) : objToString(args[1]) : "";
const outputToString = (output, method) => method !== "exec" && method !== "prepare" ? `-> ${objToString(output)}` : "";
let connId = 1;
const _SQLiteImpl = class _SQLiteImpl extends EventEmitter.EventEmitter {
  /** @param {SQLiteOptions} options */
  constructor({
    file,
    readOnly,
    verbose,
    onWillOpen,
    onDidOpen,
    autoVacuum = false,
    vacuumInterval = 30,
    // seconds while vacuuming
    vacuumPageCount = 1024 / 4,
    // 1MB in 4k pages
    name,
    // @ts-ignore
    _sqlite,
    // @ts-ignore
    _store = {},
    // @ts-ignore
    _statements = {},
    ...rest
  } = {}) {
    super();
    __publicField(this, "sql", sql);
    /** @type {{fn: function; stack: string}[]} */
    __publicField(this, "_queuedOnOpen", []);
    __publicField(this, "transactionP", Promise.resolve());
    if (Object.keys(rest).length)
      throw new Error(`Unknown options ${Object.keys(rest).join(",")}`);
    this.file = file || ":memory:";
    this.name = `${name || path.basename(this.file, ".db")}|${connId++}`;
    this.inTransaction = false;
    this.readOnly = readOnly;
    this._isChild = !!_sqlite;
    this._sqlite = _sqlite;
    this.store = _store;
    this.statements = _statements;
    this.options = {
      onWillOpen,
      onDidOpen,
      verbose,
      autoVacuum,
      vacuumInterval,
      vacuumPageCount
    };
    this.dbP = new Promise((resolve) => {
      this._resolveDbP = resolve;
    });
    this._sema = new asyncSema.Sema(1);
  }
  async _openDB() {
    const { file, readOnly, _isChild, options, store } = this;
    const { verbose, onWillOpen, onDidOpen, autoVacuum, vacuumInterval } = options;
    if (_isChild)
      throw new Error(
        `Child dbs cannot be opened. Perhaps you kept a prepared statement from a child db?`
      );
    if (onWillOpen)
      await onWillOpen();
    dbg(`${this.name} opening ${file}`);
    const _sqlite = await new Promise((resolve, reject) => {
      if (verbose)
        sqlite3.verbose();
      const mode = readOnly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
      const db = new sqlite3.Database(file, mode, (err) => {
        if (err)
          reject(new Error(`${file}: ${err.message}`));
        else
          resolve(db);
      });
    });
    _sqlite.configure(
      "busyTimeout",
      process.env.NODE_ENV === "test" ? 10 : 1e3 + Math.floor(Math.random() * 500)
    );
    const childDb = new _SQLiteImpl({
      file,
      readOnly,
      name: this.name,
      // @ts-ignore
      _sqlite,
      _store: store
    });
    if (process.env.NODE_ENV === "development" && Math.random() > 0.5)
      await childDb.exec("PRAGMA reverse_unordered_selects = ON");
    if (!readOnly) {
      if (file !== ":memory:") {
        const { journal_mode: mode } = await childDb.get("PRAGMA journal_mode");
        if (mode !== "wal") {
          const { journal_mode: journalMode } = await childDb.get("PRAGMA journal_mode = wal").catch((err) => {
            if (!isBusyError(err))
              throw err;
          });
          if (journalMode !== "wal") {
            console.error(
              `!!! WARNING: journal_mode is ${journalMode}, not WAL. Locking issues might occur!`
            );
          }
        }
      }
      if (autoVacuum) {
        const { auto_vacuum: mode } = await childDb.get(`PRAGMA auto_vacuum`);
        if (mode !== 2) {
          await childDb.exec(`PRAGMA auto_vacuum=INCREMENTAL; VACUUM`).catch((err) => {
            if (!isBusyError(err))
              throw err;
            options.autoVacuum = false;
          });
        }
        this._vacuumToken = setInterval(
          () => this._vacuumStep(),
          vacuumInterval * 10 * 1e3
        );
        this._vacuumToken.unref();
      }
      await childDb.exec(`
					PRAGMA foreign_keys = ON;
					PRAGMA recursive_triggers = ON;
					PRAGMA journal_size_limit = 4000000
				`);
      this._optimizerToken = setInterval(
        () => this.exec(`PRAGMA optimize`),
        2 * 3600 * 1e3
      );
      this._optimizerToken.unref();
      if (onDidOpen)
        await onDidOpen(childDb);
      for (const { fn, stack } of this._queuedOnOpen) {
        try {
          await fn(childDb);
        } catch (error) {
          if (error?.message)
            error.message = `in function queued ${stack?.replace(
              /^(?:[^\n]*\n){2}\s*/m,
              ""
            )}: ${error.message}`;
          throw error;
        }
      }
      this._queuedOnOpen.length = 0;
      await childDb.close();
    }
    this._sqlite = _sqlite;
    dbg(`${this.name} opened  ${file}`);
    return this;
  }
  /**
   * `true` if an sqlite connection was set up. Mostly useful for tests.
   */
  get isOpen() {
    return Boolean(this._sqlite);
  }
  /**
   * Force opening the database instead of doing it lazily on first access.
   *
   * @returns {Promise<void>} - a promise for the DB being ready to use.
   */
  open() {
    const { _resolveDbP } = this;
    if (_resolveDbP) {
      this._openingDbP = this._openDB().finally(() => {
        this._openingDbP = null;
      });
      _resolveDbP(this._openingDbP);
      this._resolveDbP = null;
      this.dbP.catch(() => this.close());
    }
    return this.dbP;
  }
  /**
   * Runs the passed function once, either immediately if the connection is
   * already open, or when the database will be opened next.
   * Note that if the function runs immediately, its return value is returned.
   * If this is a Promise, it is the caller's responsibility to handle errors.
   * Otherwise, the function will be run once after onDidOpen, and errors will
   * cause the open to fail.
   *
   * @param {(db: SQLite)=>void} fn
   * @returns {*} Either the function return value or undefined.
   */
  runOnceOnOpen(fn) {
    if (this.isOpen) {
      return fn(this);
    }
    this._queuedOnOpen.push({ fn, stack: new Error("").stack });
  }
  /**
   * Close the database connection, including the prepared statements.
   *
   * @returns {Promise<void>} - a promise for the DB being closed.
   */
  async close() {
    if (this._openingDbP) {
      dbg(`${this.name} waiting for open to complete before closing`);
      await this._openingDbP.catch(() => {
      });
    }
    if (!this._sqlite)
      return;
    const { _sqlite, _isChild } = this;
    this._sqlite = null;
    clearInterval(this._optimizerToken);
    this._optimizerToken = null;
    clearInterval(this._vacuumToken);
    this._vacuumToken = null;
    if (!_isChild)
      dbg(`${this.name} closing`);
    this.dbP = new Promise((resolve) => {
      this._resolveDbP = resolve;
    });
    const stmts = Object.values(this.statements);
    if (stmts.length)
      await Promise.all(stmts.map((stmt) => stmt.finalize().catch(() => {
      })));
    if (_isChild) {
      dbg(`${this.name} child db closed`);
      return;
    }
    if (_sqlite)
      await this._call("close", [], _sqlite, this.name);
    dbg(`${this.name} closed`);
  }
  async _hold(method) {
    if (dbgQ.enabled)
      dbgQ("_hold", this.name, method);
    await this.open();
    return this._sqlite;
  }
  async _call(method, args, obj, name, returnThis, returnFn) {
    const isStmt = obj && obj.isStatement;
    let _sqlite;
    if (!obj)
      _sqlite = await this._hold(method);
    else if (isStmt)
      _sqlite = obj._stmt;
    else
      _sqlite = obj;
    if (!_sqlite)
      throw new Error(`${name}: sqlite or statement not initialized`);
    if (!isStmt && Array.isArray(args[0])) {
      args = sql(...args);
      if (!args[1].length)
        args.pop();
    }
    const shouldDebug = dbgQ.enabled || this.listenerCount("call");
    let now, duration;
    const result = new Promise((resolve, reject) => {
      let cb, fnResult;
      const runQuery = shouldDebug ? () => {
        fnResult = this._sema.acquire().then(() => {
          now = node_perf_hooks.performance.now();
          return _sqlite[method](...args || [], cb);
        }).catch(cb);
      } : () => {
        fnResult = _sqlite[method](...args || [], cb);
      };
      let busyRetry = RETRY_COUNT;
      const self = this;
      cb = function(err, out) {
        if (shouldDebug) {
          duration = node_perf_hooks.performance.now() - now;
          self._sema.release();
        }
        if (err) {
          if (isBusyError(err) && busyRetry--) {
            dbgQ(`${name} busy, retrying`);
            busyWait().then(runQuery).catch(reject);
            return;
          }
          const error = new Error(`${name}: sqlite3: ${err.message}`);
          error.code = err.code;
          reject(error);
        } else
          resolve(
            returnFn ? fnResult : returnThis ? { lastID: this.lastID, changes: this.changes } : out
          );
      };
      if (!_sqlite[method])
        return cb({ message: `method ${method} not supported` });
      runQuery();
    });
    if (shouldDebug) {
      const query = isStmt ? obj._name : String(args[0]).replaceAll(/\s+/g, " ");
      const notify = (error, output) => {
        if (dbgQ.enabled)
          dbgQ(
            "%s",
            `${name}.${method} ${error ? `SQLite error: ${error.message} ` : ""}${query} ${argsToString(args, isStmt)} ${duration.toLocaleString(
              void 0,
              { maximumFractionDigits: 2 }
            )}ms${output ? ` ${outputToString(output, method)}` : ""}`
          );
        if (this.listenerCount("call"))
          this.emit("call", {
            name,
            method,
            isStmt,
            query,
            args: isStmt ? args : args[1],
            duration,
            output,
            error
          });
        if (error)
          throw error;
        return output;
      };
      return result.then((output) => notify(void 0, output), notify);
    }
    return result;
  }
  /**
   * Return all rows for the given query.
   *
   * @param {string} sql     - the SQL statement to be executed.
   * @param {any[]}  [vars]  - the variables to be bound to the statement.
   * @returns {Promise<Object[]>} - the results.
   */
  all(...args) {
    return this._call("all", args, this._sqlite, this.name);
  }
  /**
   * Return the first row for the given query.
   *
   * @param {string} sql     - the SQL statement to be executed.
   * @param {any[]}  [vars]  - the variables to be bound to the statement.
   * @returns {Promise<Object | null>} - the result or falsy if missing.
   */
  get(...args) {
    return this._call("get", args, this._sqlite, this.name);
  }
  /**
   * Run the given query and return the metadata.
   *
   * @param {string} sql     - the SQL statement to be executed.
   * @param {any[]}  [vars]  - the variables to be bound to the statement.
   * @returns {Promise<Object>} - an object with `lastID` and `changes`
   */
  run(...args) {
    return this._call("run", args, this._sqlite, this.name, true);
  }
  /**
   * Run the given query and return nothing. Slightly more efficient than
   * {@link run}
   *
   * @param {string} sql     - the SQL statement to be executed.
   * @param {any[]}  [vars]  - the variables to be bound to the statement.
   * @returns {Promise<void>} - a promise for execution completion.
   */
  async exec(...args) {
    await this._call("exec", args, this._sqlite, this.name);
  }
  /**
   * Register an SQL statement for repeated running. This will store the SQL and
   * will prepare the statement with SQLite whenever needed, as well as finalize
   * it when closing the connection.
   *
   * @param {string} sql     - the SQL statement to be executed.
   * @param {string} [name]  - a short name to use in debug logs.
   * @returns {Statement} - the statement.
   */
  // eslint-disable-next-line no-shadow
  prepare(sql2, name) {
    if (this.statements[sql2])
      return this.statements[sql2];
    return new Statement(this, sql2, name);
  }
  /**
   * Run the given query and call the function on each item.
   * Note that node-sqlite3 seems to just fetch all data in one go.
   *
   * @param {string} sql
   * - the SQL statement to be executed.
   * @param {any[]} [vars]
   * - the variables to be bound to the statement.
   * @param {function(Object): Promise<void>} cb
   * - the function to call on each row.
   * @returns {Promise<void>} - a promise for execution completion.
   */
  each(...args) {
    const lastIdx = args.length - 1;
    if (typeof args[lastIdx] === "function") {
      const onRow = args[lastIdx];
      args[lastIdx] = (_, row) => onRow(row);
    }
    return this._call("each", args, this._sqlite, this.name);
  }
  /**
   * Returns the data_version, which increases when other connections write to
   * the database.
   *
   * @returns {Promise<number>} - the data version.
   */
  async dataVersion() {
    if (!this._sqlite)
      await this._hold("dataVersion");
    if (!this._dataVSql)
      this._dataVSql = this.prepare("PRAGMA data_version", "dataV");
    const { data_version: v } = await this._dataVSql.get();
    return v;
  }
  /**
   * Returns or sets the user_version, an arbitrary integer connected to the
   * database.
   *
   * @param {number} [newV]  - if given, sets the user version.
   * @returns {Promise<number>} - the user version.
   */
  async userVersion(newV) {
    if (!this._sqlite)
      await this._hold("userVersion");
    if (newV)
      await this._call(
        "exec",
        [`PRAGMA user_version=${Number(newV)}`],
        this._sqlite,
        this.name
      );
    if (!this._userVSql)
      this._userVSql = this.prepare("PRAGMA user_version", "userV");
    const { user_version: v } = await this._userVSql.get();
    return v;
  }
  /**
   * Run a function in an immediate transaction. Within a connection, the
   * invocations are serialized, and between connections it uses busy retry
   * waiting. During a transaction, the database can still be read.
   *
   * @param {function} fn  - the function to call. It doesn't get any parameters.
   * @returns {Promise<void>} - a promise for transaction completion.
   * @throws - when the transaction fails or after too many retries.
   */
  async withTransaction(fn) {
    if (this.readOnly)
      throw new Error(`${this.name}: DB is readonly`);
    if (!this._sqlite)
      await this._hold("transaction");
    const nextTransaction = () => this.__withTransaction(fn);
    this.transactionP = this.transactionP.then(nextTransaction, nextTransaction);
    return this.transactionP;
  }
  async __withTransaction(fn, busyRetry = RETRY_COUNT) {
    try {
      this.inTransaction = true;
      await this.exec(`BEGIN IMMEDIATE`);
      this.emit("begin");
    } catch (error) {
      if (isBusyError(error) && busyRetry) {
        if (busyRetry === RETRY_COUNT)
          dbg(`${this.name} DB is busy, retrying`);
        await busyWait();
        return this.__withTransaction(fn, busyRetry - 1);
      }
      this.inTransaction = false;
      throw error;
    }
    let result;
    try {
      result = await fn();
    } catch (error) {
      if (process.env.NODE_ENV !== "test")
        console.error(
          `${this.name} !!! transaction failure, rolling back`,
          error
        );
      await this.exec(`ROLLBACK`);
      this.inTransaction = false;
      this.emit("rollback");
      this.emit("finally");
      throw error;
    }
    await this.exec(`END`);
    this.inTransaction = false;
    this.emit("end");
    this.emit("finally");
    return result;
  }
  async _vacuumStep() {
    if (!this._sqlite)
      return;
    const { vacuumInterval, vacuumPageCount } = this.options;
    if (!this._freeCountSql)
      this._freeCountSql = this.prepare("PRAGMA freelist_count", "freeCount");
    const { freelist_count: left } = await this._freeCountSql.get();
    if (left < vacuumPageCount * 20 || !this._sqlite)
      return;
    await this.exec(`PRAGMA incremental_vacuum(${vacuumPageCount})`);
    const t = setTimeout(() => this._vacuumStep(), vacuumInterval * 1e3);
    t.unref();
  }
};
__publicField(_SQLiteImpl, "sql", sql);
let SQLiteImpl = _SQLiteImpl;
exports.default = SQLiteImpl;
exports.sql = sql;
exports.valToSql = valToSql;
