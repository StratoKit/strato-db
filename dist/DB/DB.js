"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports._getRanMigrations = void 0;

var _sortBy2 = _interopRequireDefault(require("lodash/sortBy"));

var _debug = _interopRequireDefault(require("debug"));

var _SQLite = _interopRequireWildcard(require("./SQLite"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const dbg = (0, _debug.default)('strato-db/DB');

const _getRanMigrations = async db => {
  if (!(await db.get(`SELECT 1 FROM sqlite_master WHERE name="{sdb} migrations"`))) {
    if (await db.get(`SELECT 1 FROM sqlite_master WHERE name="_migrations"`)) await db.exec(`ALTER TABLE _migrations RENAME TO "{sdb} migrations"`);else await db.exec(`CREATE TABLE "{sdb} migrations"(
				runKey TEXT,
				ts DATETIME,
				up BOOLEAN
			);`);
  }

  const didRun = {};
  await db.each(`
			SELECT runKey, max(ts) AS ts, up FROM "{sdb} migrations"
			GROUP BY runKey
			HAVING up = 1
		`, ({
    runKey
  }) => {
    didRun[runKey] = true;
  });
  return didRun;
};

exports._getRanMigrations = _getRanMigrations;

const _markMigration = async (db, runKey, up) => {
  const ts = Math.round(Date.now() / 1000);
  up = up ? 1 : 0;
  await db.run`INSERT INTO "{sdb} migrations" VALUES (${runKey}, ${ts}, ${up})`;
};
/**
 * DB adds model management and migrations to Wrapper.
 * The migration state is kept in the table ""{sdb} migrations"".
 * @extends SQLite
 */


class DB extends _SQLite.default {
  /**
   * @param {object} options options for DB and SQLite
   * @param {boolean} [options.readOnly] open the DB read-only
   * @param {Array} [options.migrations] migration definitions
   * @param {function} [options.onBeforeMigrations] called with the `db` before migrations run. Not called for read-only
   * @param {function} [options.onDidOpen] called with the `db` after migrations ran. If readOnly is set, it runs after opening DB. The DB is open after this function resolves
   */
  constructor(_ref = {}) {
    let {
      migrations = [],
      onBeforeMigrations
    } = _ref,
        options = _objectWithoutProperties(_ref, ["migrations", "onBeforeMigrations"]);

    const onDidOpen = options.readOnly ? options.onDidOpen : async db => {
      if (onBeforeMigrations) await onBeforeMigrations(db);
      await this.runMigrations(db);
      if (options.onDidOpen) await options.onDidOpen(db);
    };
    super(_objectSpread({}, options, {
      onDidOpen
    }));
    this.options.migrations = migrations;
  }

  get models() {
    if (process.env.NODE_ENV !== 'production' && !this.warnedModel) console.error(new Error('!!! db.models is deprecated, use db.store instead'));
    return this.store;
  }
  /**
   * Add a model to the DB, which will manage one or more tables in the SQLite database.
   * The model should use the given `db` instance at creation time.
   * @param {Object} Model - a class
   * @param {object} options - options passed during Model creation
   * @returns {object} - the created Model instance
   */


  addModel(Model, options) {
    const model = new Model(_objectSpread({}, options, {
      db: this
    }));
    if (this.store[model.name]) throw new TypeError(`Model name ${model.name} was already added`);
    this.store[model.name] = model;
    return model;
  }
  /**
   * Register an object with migrations
   * @param {string} name - the name under which to register these migrations
   * @param {object<object<function>>} migrations - the migrations object
   * @returns {void}
   */


  registerMigrations(name, migrations) {
    if (this.migrationsRan) {
      throw new Error('migrations already done');
    }

    for (const key of Object.keys(migrations)) {
      let obj = migrations[key];

      if (typeof obj === 'function') {
        obj = {
          up: obj
        };
      } else if (!obj.up) {
        throw new Error(`Migration ${key} for "${name}" must be a function or have an "up({db, model, ...rest})" attribute`);
      } // Separate with space, it sorts before other things


      const runKey = `${key} ${name}`;
      this.options.migrations.push(_objectSpread({}, obj, {
        runKey
      }));
    }
  }
  /**
   * Runs the migrations in a transaction and waits for completion
   * @param {SQLite} db - an opened SQLite instance
   * @returns {Promise<void>} - promise for completed migrations
   */


  async runMigrations(db) {
    const {
      store
    } = this;
    const migrations = (0, _sortBy2.default)(this.options.migrations, ({
      runKey
    }) => runKey);
    await db.withTransaction(async () => {
      const didRun = await _getRanMigrations(db);

      for (const model of Object.values(store)) if (model.setWritable) model.setWritable(true);

      for (const _ref2 of migrations) {
        const {
          runKey,
          up
        } = _ref2;

        if (!didRun[runKey]) {
          dbg(this.name, 'start migration', runKey);
          await up(db); // eslint-disable-line no-await-in-loop

          dbg(this.name, 'done migration', runKey);
          await _markMigration(db, runKey, 1); // eslint-disable-line no-await-in-loop
        }
      }

      for (const model of Object.values(store)) if (model.setWritable) model.setWritable(false);
    });
    this.migrationsRan = true; // Protect against store updates during migrations

    this.store = store;
  }

}

_defineProperty(DB, "sql", _SQLite.sql);

var _default = DB;
exports.default = _default;
//# sourceMappingURL=DB.js.map