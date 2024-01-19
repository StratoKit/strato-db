"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const lodash = require("lodash");
const debug = require("debug");
const SQLite = require("./SQLite.js");
const warning = require("../lib/warning.js");
const dbg = debug("strato-db/DB");
const _getRanMigrations = async (db) => {
  if (!await db.get(`SELECT 1 FROM sqlite_master WHERE name="{sdb} migrations"`)) {
    await (await db.get(
      `SELECT 1 FROM sqlite_master WHERE name="_migrations"`
    ) ? db.exec(`ALTER TABLE _migrations RENAME TO "{sdb} migrations"`) : db.exec(`CREATE TABLE "{sdb} migrations"(
				runKey TEXT,
				ts DATETIME,
				up BOOLEAN
			);`));
  }
  const didRun = {};
  await db.each(
    `
			SELECT runKey, max(ts) AS ts, up FROM "{sdb} migrations"
			GROUP BY runKey
			HAVING up = 1
		`,
    ({ runKey }) => {
      didRun[runKey] = true;
    }
  );
  return didRun;
};
const _markMigration = async (db, runKey, up) => {
  const ts = Math.round(Date.now() / 1e3);
  up = up ? 1 : 0;
  await db.run`INSERT INTO "{sdb} migrations" VALUES (${runKey}, ${ts}, ${up})`;
};
class DBImpl extends SQLite.default {
  /** @param {DBOptions} options */
  constructor({ migrations = [], onBeforeMigrations, ...options } = {}) {
    const onDidOpen = options.readOnly ? options.onDidOpen : async (db) => {
      if (onBeforeMigrations)
        await onBeforeMigrations(db);
      await this.runMigrations(db);
      if (options.onDidOpen)
        await options.onDidOpen(db);
    };
    super({ ...options, onDidOpen });
    this.options.migrations = migrations;
  }
  get models() {
    if (warning.DEV)
      warning.deprecated(`use db.store instead of db.models`);
    return this.store;
  }
  /**
   * Add a model to the DB, which will manage one or more tables in the SQLite
   * database.
   * The model should use the given `db` instance at creation time.
   *
   * @param {Object} Model    - a class.
   * @param {Object} options  - options passed during Model creation.
   * @returns {Object} - the created Model instance.
   */
  addModel(Model, options) {
    const model = new Model({
      ...options,
      db: this
    });
    if (this.store[model.name])
      throw new TypeError(`Model name ${model.name} was already added`);
    this.store[model.name] = model;
    return model;
  }
  /**
   * Register an object with migrations.
   *
   * @param {string} name
   * - the name under which to register these migrations.
   * @param {Record<string, function | Record<string, function>>} migrations
   * - the migrations object.
   * @returns {void}
   */
  registerMigrations(name, migrations) {
    if (this.migrationsRan) {
      throw new Error("migrations already done");
    }
    for (const key of Object.keys(migrations)) {
      let obj = migrations[key];
      if (typeof obj === "function") {
        obj = { up: obj };
      } else if (!obj.up) {
        throw new Error(
          `Migration ${key} for "${name}" must be a function or have an "up({db, model, ...rest})" attribute`
        );
      }
      const runKey = `${key} ${name}`;
      this.options.migrations.push({
        ...obj,
        runKey
      });
    }
  }
  /**
   * Runs the migrations in a transaction and waits for completion.
   *
   * @param {SQLite} db  - an opened SQLite instance.
   * @returns {Promise<void>} - promise for completed migrations.
   */
  async runMigrations(db) {
    const { store, options } = this;
    const migrations = lodash.sortBy(options.migrations, ({ runKey }) => runKey);
    await db.withTransaction(async () => {
      const didRun = await _getRanMigrations(db);
      for (const model of Object.values(store))
        if (model.setWritable)
          model.setWritable(true);
      for (const { runKey, up } of migrations) {
        if (!didRun[runKey]) {
          dbg(this.name, "start migration", runKey);
          await up(db);
          dbg(this.name, "done migration", runKey);
          await _markMigration(db, runKey, 1);
        }
      }
      for (const model of Object.values(store))
        if (model.setWritable)
          model.setWritable(false);
    });
    this.migrationsRan = true;
    this.store = store;
  }
}
__publicField(DBImpl, "sql", SQLite.sql);
exports._getRanMigrations = _getRanMigrations;
exports.default = DBImpl;
