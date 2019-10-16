"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _debug = _interopRequireDefault(require("debug"));

var _JsonModel = _interopRequireDefault(require("./JsonModel"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const dbg = (0, _debug.default)('strato-db/queue');
/**
 * An event queue, including history
 * @extends JsonModel
 */

class EventQueue extends _JsonModel.default {
  /**
   * @typedef Event
   * @type {Object}
   * @property {Number} v - the version
   * @property {String} type - event type
   * @property {Number} ts - ms since epoch of event
   * @property {*} [data] - event data
   * @property {Object} [result] - event processing result
   */

  /**
   * Creates a new EventQueue model, called by DB
   * @constructor
   * @param  {string} [name='history'] - the table name
   * @param  {boolean} [forever] - should getNext poll forever?
   * @param  {boolean} [withViews] - add views to the database to assist with inspecting the data
   * @param  {Object} [...rest] - other params are passed to JsonModel
   */
  constructor(_ref) {
    let {
      name = 'history',
      forever,
      withViews
    } = _ref,
        rest = _objectWithoutProperties(_ref, ["name", "forever", "withViews"]);

    const columns = {
      v: {
        type: 'INTEGER',
        autoIncrement: true
      },
      type: {
        type: 'TEXT'
      },
      ts: {
        type: 'INTEGER',
        value: o => Number(o.ts) || Date.now(),
        index: 'ALL'
      },
      data: {
        type: 'JSON'
      },
      result: {
        type: 'JSON'
      },
      size: {
        type: 'INTEGER',
        default: 0,
        get: false
      }
    };
    if (rest.columns) for (const [key, value] of Object.entries(rest.columns)) {
      if (!value) continue;
      if (columns[key]) throw new TypeError(`Cannot override column ${key}`);
      columns[key] = value;
    }
    super(_objectSpread({}, rest, {
      name,
      idCol: 'v',
      columns,
      migrations: _objectSpread({}, rest.migrations, {
        addTypeSizeIndex: ({
          db
        }) => db.exec(`CREATE INDEX IF NOT EXISTS "history type,size" on history(type, size)`),
        '20190521_addViews': withViews ? async ({
          db
        }) => {
          const historySchema = await db.all('PRAGMA table_info("history")'); // This adds a field with data size, kept up-to-date with triggers

          if (!historySchema.some(f => f.name === 'size')) await db.exec(`ALTER TABLE history ADD COLUMN size INTEGER DEFAULT 0`); // The size WHERE clause is to prevent recursive triggers

          await db.exec(`
								DROP TRIGGER IF EXISTS "history size insert";
								DROP TRIGGER IF EXISTS "history size update";
								CREATE TRIGGER "history size insert" AFTER INSERT ON history BEGIN
									UPDATE history SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE v=new.v;
								END;
								CREATE TRIGGER "history size update" AFTER UPDATE ON history BEGIN
									UPDATE history SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE v=new.v AND size!=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0);
								END;

								DROP VIEW IF EXISTS _recentHistory;
								DROP VIEW IF EXISTS _historyTypes;
								CREATE VIEW _recentHistory AS
									SELECT datetime(ts/1000, "unixepoch", "localtime") AS t, *
									FROM history ORDER BY v DESC LIMIT 1000;
								CREATE VIEW _historyTypes AS
									SELECT
										type,
										COUNT(*) AS count,
										SUM(size)/1024/1024 AS MB
									FROM history GROUP BY type ORDER BY count DESC;
							`); // Recalculate size

          await db.exec(`UPDATE history SET size=0`);
        } : null
      })
    }));

    _defineProperty(this, "_addP", null);

    _defineProperty(this, "_nextAddedP", null);

    _defineProperty(this, "_nextAddedResolve", event => {
      if (!this._resolveNAP) return;
      clearTimeout(this._addTimer);
      this._NAPresolved = true;

      this._resolveNAP(event);
    });

    this.currentV = -1;
    this.knownV = 0;
    this.forever = !!forever;
  }
  /**
   * Replace existing event data
   * @param  {Event} event - the new event
   * @returns {Promise<void>} - Promise for set completion
   */


  set(event) {
    if (!event.v) {
      throw new Error('cannot use set without v');
    }

    this.currentV = -1;
    return super.set(event);
  }
  /**
   * Get the highest version stored in the queue
   * @returns {Promise<number>} - the version
   */


  async latestVersion() {
    var _this$_maxSql;

    if (this._addP) await this._addP;
    const dataV = await this.db.dataVersion();

    if (this.currentV >= 0 && this._dataV === dataV) {
      // If there was no change on other connections, currentV is correct
      return this.currentV;
    }

    this._dataV = dataV;
    if (((_this$_maxSql = this._maxSql) === null || _this$_maxSql === void 0 ? void 0 : _this$_maxSql.db) !== this.db) this._maxSql = this.db.prepare(`SELECT MAX(v) AS v from ${this.quoted}`, 'maxV');
    const lastRow = await this._maxSql.get();
    this.currentV = Math.max(this.knownV, lastRow.v || 0);
    return this.currentV;
  }

  /**
   * Atomically add an event to the queue
   * @param  {string} type - event type
   * @param  {*} [data] - event data
   * @param  {Number} [ts=Date.now()] - event timestamp, ms since epoch
   * @returns {Promise<Event>} - Promise for the added event
   */
  add(type, data, ts) {
    if (!type || typeof type !== 'string') return Promise.reject(new Error('type should be a non-empty string'));
    ts = Number(ts) || Date.now(); // We need to guarantee same-process in-order insertion, the sqlite3 lib doesn't do it :(

    this._addP = (this._addP || Promise.resolve()).then(async () => {
      var _this$_addSql;

      // Store promise so latestVersion can get the most recent v
      // Note that it replaces the promise for the previous add
      // sqlite-specific: INTEGER PRIMARY KEY is also the ROWID and therefore the lastID and v
      if (((_this$_addSql = this._addSql) === null || _this$_addSql === void 0 ? void 0 : _this$_addSql.db) !== this.db) this._addSql = this.db.prepare(`INSERT INTO ${this.quoted}(type,ts,data) VALUES (?,?,?)`, 'add');
      const {
        lastID: v
      } = await this._addSql.run([type, ts, JSON.stringify(data)]);
      this.currentV = v;
      const event = {
        v,
        type,
        ts,
        data
      };
      dbg(`queued`, v, type);

      if (this._nextAddedResolve) {
        this._nextAddedResolve(event);
      }

      return event;
    });
    return this._addP;
  }

  // promise to wait for next event with timeout
  _makeNAP() {
    if (this._nextAddedP && !this._NAPresolved) return;
    this._nextAddedP = new Promise(resolve => {
      this._resolveNAP = resolve;
      this._NAPresolved = false; // Timeout after 10s so we can also get events from other processes

      this._addTimer = setTimeout(this._nextAddedResolve, 10000); // if possible, mark the timer as non-blocking for process exit
      // some mocking libraries might forget to add unref()

      if (!this.forever && this._addTimer && this._addTimer.unref) this._addTimer.unref();
    });
  }
  /**
   Get the next event after v (gaps are ok).
   The wait can be cancelled by `.cancelNext()`.
   * @param  {number} [v=0] the version
   * @param  {boolean} [noWait] do not wait for the next event
   * @returns {Promise<Event>} the event if found
   */


  async getNext(v = 0, noWait) {
    let event;
    if (!noWait) dbg(`${this.name} waiting unlimited until >${v}`);

    do {
      this._makeNAP(); // eslint-disable-next-line no-await-in-loop


      const currentV = await this.latestVersion();
      event = v < currentV ? // eslint-disable-next-line no-await-in-loop
      await this.searchOne(null, {
        where: {
          'v > ?': [Number(v)]
        },
        sort: {
          v: 1
        }
      }) : null;
      if (event || noWait) break; // Wait for next one from this process
      // eslint-disable-next-line no-await-in-loop

      event = await this._nextAddedP;
      if (event === 'CANCEL') return; // Ignore previous events

      if (v && event && event.v < v) event = null;
    } while (!event);

    return event;
  }
  /**
   * Cancel any pending `.getNext()` calls
   */


  cancelNext() {
    if (!this._resolveNAP) return;

    this._resolveNAP('CANCEL');
  }
  /**
   * Set the latest known version.
   * New events will have higher versions.
   * @param  {number} v - the last known version
   */


  async setKnownV(v) {
    // set the sqlite autoincrement value
    // Try changing current value, and insert if there was no change
    // This doesn't need a transaction, either one or the other runs
    // TODO alsoLower flag and only update where seq < v
    await this.db.exec(`
				UPDATE sqlite_sequence SET seq = ${v} WHERE name = ${this.quoted};
				INSERT INTO sqlite_sequence (name, seq)
					SELECT ${this.quoted}, ${v} WHERE NOT EXISTS
						(SELECT changes() AS change FROM sqlite_sequence WHERE change <> 0);
			`);
    this.currentV = Math.max(this.currentV, v);
    this.knownV = v;
  }

}

var _default = EventQueue;
exports.default = _default;
//# sourceMappingURL=EventQueue.js.map