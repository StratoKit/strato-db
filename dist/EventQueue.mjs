var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import debug from "debug";
import "uuid";
import "lodash";
import "./DB/DB.mjs";
import "./DB/SQLite.mjs";
import JsonModelImpl from "./JsonModel/JsonModel.mjs";
const dbg = debug("strato-db/queue");
let warnedLatest;
const defaultColumns = {
  v: {
    type: "INTEGER",
    autoIncrement: true
  },
  type: { type: "TEXT" },
  ts: {
    type: "INTEGER",
    value: (o) => Number(o.ts) || Date.now(),
    index: "ALL"
  },
  data: { type: "JSON" },
  result: { type: "JSON" },
  size: { type: "INTEGER", default: 0, get: false }
};
class EventQueueImpl extends JsonModelImpl {
  /** @param {EQOptions<T, U>} */
  constructor({ name = "history", forever, withViews, ...rest }) {
    const columns = { ...defaultColumns };
    if (rest.columns)
      for (const [key, value] of Object.entries(rest.columns)) {
        if (!value)
          continue;
        if (columns[key])
          throw new TypeError(`Cannot override column ${key}`);
        columns[key] = value;
      }
    super({
      ...rest,
      name,
      idCol: "v",
      columns,
      migrations: {
        ...rest.migrations,
        addTypeSizeIndex: ({ db }) => db.exec(
          `CREATE INDEX IF NOT EXISTS "history type,size" on history(type, size)`
        ),
        "20190521_addViews": withViews ? async ({ db }) => {
          const historySchema = await db.all('PRAGMA table_info("history")');
          if (!historySchema.some((f) => f.name === "size"))
            await db.exec(
              `ALTER TABLE history ADD COLUMN size INTEGER DEFAULT 0`
            );
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
							`);
          await db.exec(`UPDATE history SET size=0`);
        } : null
      }
    });
    __publicField(this, "_addP", null);
    __publicField(this, "_nextAddedP", null);
    __publicField(this, "_nextAddedResolve", (event) => {
      if (!this._resolveNAP)
        return;
      clearTimeout(this._addTimer);
      this._NAPresolved = true;
      this._resolveNAP(event);
    });
    this.currentV = -1;
    this.knownV = 0;
    this.forever = !!forever;
  }
  /**
   * Replace existing event data.
   *
   * @param {Event} event  - the new event.
   * @returns {Promise<void>} - Promise for set completion.
   */
  set(event) {
    if (!event.v) {
      throw new Error("cannot use set without v");
    }
    this.currentV = -1;
    return super.set(event);
  }
  latestVersion() {
    if (process.env.NODE_ENV !== "production" && !warnedLatest) {
      const { stack } = new Error(
        "EventQueue: latestVersion() is deprecated, use getMaxV instead"
      );
      console.error(stack);
      warnedLatest = true;
    }
    return this.getMaxV();
  }
  /**
   * Get the highest version stored in the queue.
   *
   * @returns {Promise<number>} - the version.
   */
  async getMaxV() {
    if (this._addP)
      await this._addP;
    const dataV = await this.db.dataVersion();
    if (this.currentV >= 0 && this._dataV === dataV) {
      return this.currentV;
    }
    this._dataV = dataV;
    if (this._maxSql?.db !== this.db)
      this._maxSql = this.db.prepare(
        `SELECT MAX(v) AS v from ${this.quoted}`,
        "maxV"
      );
    const lastRow = await this._maxSql.get();
    this.currentV = Math.max(this.knownV, lastRow.v || 0);
    return this.currentV;
  }
  /**
   * Atomically add an event to the queue.
   *
   * @param {string} type             - event type.
   * @param {*}      [data]           - event data.
   * @param {number} [ts=Date.now()]  - event timestamp, ms since epoch.
   * @returns {Promise<Event>} - Promise for the added event.
   */
  add(type, data, ts) {
    if (!type || typeof type !== "string")
      return Promise.reject(new Error("type should be a non-empty string"));
    ts = Number(ts) || Date.now();
    this._addP = (this._addP || Promise.resolve()).then(async () => {
      if (this._addSql?.db !== this.db)
        this._addSql = this.db.prepare(
          `INSERT INTO ${this.quoted}(type,ts,data) VALUES (?,?,?)`,
          "add"
        );
      const { lastID: v } = await this._addSql.run([
        type,
        ts,
        JSON.stringify(data)
      ]);
      this.currentV = v;
      const event = { v, type, ts, data };
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
    if (this._nextAddedP && !this._NAPresolved)
      return;
    this._nextAddedP = new Promise((resolve) => {
      this._resolveNAP = resolve;
      this._NAPresolved = false;
      this._addTimer = setTimeout(this._nextAddedResolve, 1e4);
      if (!this.forever && this._addTimer && this._addTimer.unref)
        this._addTimer.unref();
    });
  }
  /**
   * Get the next event after v (gaps are ok).
   * The wait can be cancelled by `.cancelNext()`.
   *
   * @param {number}  [v=0]     The version.
   * @param {boolean} [noWait]  Do not wait for the next event.
   * @returns {Promise<Event>} The event if found.
   */
  async getNext(v = 0, noWait = false) {
    let event;
    if (!noWait)
      dbg(`${this.name} waiting unlimited until >${v}`);
    do {
      this._makeNAP();
      const currentV = await this.getMaxV();
      event = v < currentV ? await this.searchOne(null, {
        where: { "v > ?": [Number(v)] },
        sort: { v: 1 }
      }) : null;
      if (event || noWait)
        break;
      event = await this._nextAddedP;
      if (event === "CANCEL")
        return;
      if (v && event && event.v < v)
        event = null;
    } while (!event);
    return event;
  }
  /**
   * Cancel any pending `.getNext()` calls
   */
  cancelNext() {
    if (!this._resolveNAP)
      return;
    this._resolveNAP("CANCEL");
  }
  /**
   * Set the latest known version.
   * New events will have higher versions.
   *
   * @param {number} v  - the last known version.
   */
  setKnownV(v) {
    this.db.runOnceOnOpen(
      (db) => db.exec(
        `
					UPDATE sqlite_sequence SET seq = ${v} WHERE name = ${this.quoted};
					INSERT INTO sqlite_sequence (name, seq)
						SELECT ${this.quoted}, ${v} WHERE NOT EXISTS
							(SELECT changes() AS change FROM sqlite_sequence WHERE change <> 0);
				`
      ).catch((error) => {
        console.error(`setKnownV: could not update sequence`, error);
        db.close();
      })
    );
    this.currentV = Math.max(this.currentV, v);
    this.knownV = v;
  }
}
export {
  EventQueueImpl as default
};
