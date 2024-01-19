"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const debug = require("debug");
const jsurl = require("jsurl2");
require("../DB/DB.js");
const SQLite = require("../DB/SQLite.js");
const DataLoader = require("dataloader");
const lodash = require("lodash");
const normalizeColumn = require("./normalizeColumn.js");
const assignJsonParents = require("./assignJsonParents.js");
const prepareSqlCol = require("./prepareSqlCol.js");
const verifyOptions = require("./verifyOptions.js");
const makeMigrations = require("./makeMigrations.js");
const makeDefaultIdValue = require("./makeDefaultIdValue.js");
const settleAll = require("../lib/settleAll.js");
const warning = require("../lib/warning.js");
const dbg = debug("strato-db/JSON");
const encodeCursor = (row, cursorKeys, invert) => {
  const encoded = jsurl.stringify(
    cursorKeys.map((k) => row[k]),
    { short: true }
  );
  return invert ? `!${encoded}` : encoded;
};
const decodeCursor = (cursor) => {
  let cursorVals, invert = false;
  if (cursor) {
    if (cursor.startsWith("!!")) {
      invert = true;
      cursor = cursor.slice(1);
    }
    cursorVals = jsurl.parse(cursor);
  }
  return { cursorVals, invert };
};
class JsonModelImpl {
  /** @param {JMOptions<Item, IDCol>} options  - the model declaration. */
  constructor(options) {
    __publicField(this, "parseRow", (row, options) => {
      const mapCols = options && options.cols ? options.cols.map((n) => this.columns[n]) : this.getCols;
      const out = this.Item ? new this.Item() : {};
      for (const k of mapCols) {
        let val;
        if (dbg.enabled) {
          try {
            val = k.parse ? k.parse(row[k.alias]) : row[k.alias];
          } catch (err) {
            dbg(
              `!!! ${this.name}.${k.name}:  parse failed for value ${String(
                row[k.alias]
              ).slice(0, 20)}`
            );
            throw err;
          }
        } else {
          val = k.parse ? k.parse(row[k.alias]) : row[k.alias];
        }
        if (val != null) {
          if (k.path) {
            if (k.real) {
              const prevVal = lodash.get(out, k.path);
              if (typeof prevVal !== "undefined")
                continue;
            }
            lodash.set(out, k.path, val);
          } else
            Object.assign(out, val);
        }
      }
      return out;
    });
    // Converts a row or array of rows to objects
    __publicField(this, "toObj", (thing, options) => {
      if (!thing) {
        return;
      }
      if (Array.isArray(thing)) {
        return thing.map((r) => this.parseRow(r, options));
      }
      return this.parseRow(thing, options);
    });
    verifyOptions.verifyOptions(options);
    const {
      db,
      name,
      migrations,
      migrationOptions,
      columns,
      ItemClass,
      idCol = "id",
      keepRowId = true
    } = options;
    this.db = db;
    this.name = name;
    this.quoted = SQLite.sql.quoteId(name);
    this.idCol = idCol;
    this.idColQ = SQLite.sql.quoteId(idCol);
    this.Item = ItemClass;
    const idColDef = columns && columns[idCol] || {};
    const jsonColDef = columns && columns.json || {};
    const allColumns = {
      ...columns,
      [idCol]: {
        type: idColDef.type || "TEXT",
        alias: idColDef.alias || "_i",
        value: makeDefaultIdValue.makeIdValue(idCol, idColDef),
        index: "ALL",
        autoIncrement: idColDef.autoIncrement,
        unique: true,
        get: true
      },
      json: {
        alias: jsonColDef.alias || "_j",
        // return null if empty, makes parseRow faster
        parse: jsonColDef.parse || prepareSqlCol.parseJson,
        stringify: jsonColDef.stringify || prepareSqlCol.stringifyJsonObject,
        type: "JSON",
        alwaysObject: true,
        path: "",
        get: true
      }
    };
    this.columnArr = [];
    this.columns = {};
    let i = 0;
    for (const colName of Object.keys(allColumns)) {
      const colDef = allColumns[colName];
      let col;
      if (typeof colDef === "function") {
        col = colDef({ columnName: colName });
        verifyOptions.verifyColumn(colName, col);
      } else {
        col = { ...colDef };
      }
      col.alias = col.alias || `_${i++}`;
      if (this.columns[col.alias])
        throw new TypeError(
          `Cannot alias ${col.name} over existing name ${col.alias}`
        );
      normalizeColumn.normalizeColumn(col, colName);
      this.columns[colName] = col;
      this.columns[col.alias] = col;
      this.columnArr.push(col);
    }
    assignJsonParents.assignJsonParents(this.columnArr);
    for (const col of this.columnArr)
      prepareSqlCol.prepareSqlCol(col, this.name);
    this.getCols = this.columnArr.filter((c) => c.get).sort(prepareSqlCol.byPathLength);
    this.db.registerMigrations(
      name,
      makeMigrations.makeMigrations({
        name: this.name,
        columns: this.columns,
        idCol,
        keepRowId,
        migrations,
        migrationOptions
      })
    );
    this._set = this._makeSetFn();
    this.selectCols = this.columnArr.filter((c) => c.get || c.name === "json");
    this.selectColNames = this.selectCols.map((c) => c.name);
    this.selectColAliases = this.selectCols.map((c) => c.alias);
    this.selectColsSql = this.selectCols.map((c) => c.select).join(",");
  }
  _makeSetFn() {
    const { db, Item, columnArr, quoted, idCol, name } = this;
    const valueCols = columnArr.filter((c) => c.value).sort(prepareSqlCol.byPathLength);
    const realCols = columnArr.filter((c) => c.real).sort(prepareSqlCol.byPathLengthDesc).map((c, i) => ({
      ...c,
      i,
      valueI: c.value && valueCols.indexOf(c)
    }));
    const setCols = [...realCols].filter((c) => c.get).reverse();
    const mutators = /* @__PURE__ */ new Set();
    for (const col of valueCols) {
      for (let i = 1; i < col.parts.length; i++)
        mutators.add(col.parts.slice(0, i).join("."));
    }
    for (const col of realCols) {
      for (let i = 1; i < col.parts.length; i++)
        if (col.get)
          mutators.add(col.parts.slice(0, i).join("."));
    }
    const mutatePaths = [...mutators].sort(
      (a, b) => (a ? a.split(".").length : 0) - (b ? b.split(".").length : 0)
    );
    const cloneObj = mutatePaths.length ? (obj) => {
      obj = { ...obj };
      for (const path of mutatePaths) {
        lodash.set(obj, path, { ...lodash.get(obj, path) });
      }
      return obj;
    } : (obj) => ({ ...obj });
    const colSqls = realCols.map((col) => col.quoted);
    const setSql = `INTO ${quoted}(${colSqls.join(",")}) VALUES(${colSqls.map(() => "?").join(",")})`;
    return async (o, insertOnly, noReturn) => {
      if (this._insertSql?.db !== db) {
        this._insertSql = db.prepare(`INSERT ${setSql}`, `ins ${name}`);
        const updateSql = colSqls.map((col, i) => `${col} = ?${i + 1}`).join(", ");
        this._updateSql = db.prepare(
          `INSERT ${setSql} ON CONFLICT(${idCol}) DO UPDATE SET ${updateSql}`,
          `set ${name}`
        );
      }
      const { _insertSql, _updateSql } = this;
      const obj = cloneObj(o);
      const results = await Promise.all(
        valueCols.map(
          (col) => (
            // value functions must be able to use other db during migrations, so call with our this
            col.value.call(this, obj)
          )
        )
      );
      for (const [i, r] of results.entries()) {
        const col = valueCols[i];
        if (col.path && (!col.real || col.get))
          lodash.set(obj, col.path, r);
      }
      const colVals = realCols.map((col) => {
        let v;
        if (col.path) {
          v = col.value ? results[col.valueI] : lodash.get(obj, col.path);
          if (col.get)
            lodash.set(obj, col.path, void 0);
        } else {
          v = obj;
        }
        return col.stringify ? col.stringify(v) : v;
      });
      const P = insertOnly ? _insertSql.run(colVals) : _updateSql.run(colVals);
      return noReturn ? P : P.then((result) => {
        const newObj = Item ? new Item() : {};
        for (const col of setCols) {
          const val = colVals[col.i];
          const v = col.parse ? col.parse(val) : val;
          if (col.path === "")
            Object.assign(newObj, v);
          else
            lodash.set(newObj, col.path, v);
        }
        if (newObj[this.idCol] == null) {
          newObj[this.idCol] = result.lastID;
        }
        return newObj;
      });
    };
  }
  _colSql(colName) {
    return this.columns[colName] ? this.columns[colName].sql : colName;
  }
  /**
   * Parses query options into query parts. Override this function to implement
   * search behaviors.
   */
  makeSelect(options) {
    if (process.env.NODE_ENV !== "production") {
      const extras = Object.keys(options).filter(
        (k) => ![
          "attrs",
          "cols",
          "cursor",
          "distinct",
          "join",
          "joinVals",
          "limit",
          "noCursor",
          "noTotal",
          "offset",
          "sort",
          "where"
        ].includes(k)
      );
      if (extras.length) {
        console.warn("Got unknown options for makeSelect:", extras, options);
      }
    }
    let {
      attrs,
      cols,
      cursor,
      distinct,
      join,
      joinVals,
      limit,
      noCursor,
      noTotal,
      offset,
      sort,
      where: extraWhere
    } = options;
    cols = cols || this.selectColNames;
    let cursorColAliases, cursorQ, cursorArgs;
    const makeCursor = limit && !noCursor;
    const { cursorVals, invert } = decodeCursor(cursor);
    if (cursor || makeCursor) {
      sort = sort && sort[this.idCol] ? sort : { ...sort, [this.idCol]: 1e5 };
    }
    const sortNames = sort && Object.keys(sort).filter((k) => sort[k]).sort((a, b) => Math.abs(sort[a]) - Math.abs(sort[b]));
    if (makeCursor || cursor) {
      let copiedCols = false;
      for (const colName of sortNames) {
        if (!cols.includes(colName)) {
          if (!copiedCols) {
            cols = [...cols];
            copiedCols = true;
          }
          cols.push(colName);
        }
      }
      cursorColAliases = sortNames.map(
        (c) => this.columns[c] ? this.columns[c].alias : c
      );
    }
    if (cursor) {
      const getDir = (i) => sort[sortNames[i]] < 0 ^ invert ? "<" : ">";
      const len = cursorVals.length - 1;
      cursorQ = `${cursorColAliases[len]}${getDir(len)}?`;
      cursorArgs = [cursorVals[len]];
      for (let i = len - 1; i >= 0; i--) {
        cursorQ = `(${cursorColAliases[i]}${getDir(i)}=? AND (${cursorColAliases[i]}!=? OR ${cursorQ}))`;
        const val = cursorVals[i];
        cursorArgs.unshift(val, val);
      }
    }
    const colsSql = cols === this.selectColNames ? this.selectColsSql : cols.map((c) => this.columns[c] ? this.columns[c].select : c).join(",");
    const selectQ = `SELECT${distinct ? " DISTINCT" : ""} ${colsSql} FROM ${this.quoted} tbl`;
    const vals = [];
    const conds = [];
    if (extraWhere) {
      for (const w of Object.keys(extraWhere)) {
        const val = extraWhere[w];
        if (val) {
          if (!Array.isArray(val)) {
            throw new TypeError(
              `Error: Got where without array of args for makeSelect: ${w}, val: ${val}`
            );
          }
          conds.push(w);
          vals.push(...extraWhere[w]);
        }
      }
    }
    if (attrs) {
      for (const a of Object.keys(attrs)) {
        let val = attrs[a];
        if (val == null)
          continue;
        const col = this.columns[a];
        if (!col) {
          throw new Error(`Unknown column ${a}`);
        }
        const origVal = val;
        const { where, whereVal } = col;
        let valid = true;
        if (whereVal) {
          val = whereVal(val);
          if (Array.isArray(val)) {
            vals.push(...val);
          } else {
            if (val)
              throw new Error(`whereVal for ${a} should return array or falsy`);
            valid = false;
          }
        } else {
          vals.push(col.stringify ? col.stringify(val) : val);
        }
        if (valid) {
          conds.push(typeof where === "function" ? where(val, origVal) : where);
        }
      }
    }
    const orderQ = sortNames?.length && `ORDER BY ${sortNames.map((k) => {
      const col = this.columns[k];
      const colSql = col ? cols.includes(col.name) ? col.alias : col.sql : k;
      return `${colSql}${sort[k] < 0 ^ invert ? ` DESC` : ``}`;
    }).join(",")}`;
    const limitQ = limit && `LIMIT ${Number(limit) || 10}`;
    const offsetQ = offset && `OFFSET ${Number(offset) || 0}`;
    if (join && joinVals && joinVals.length) {
      vals.unshift(...joinVals);
    }
    const calcTotal = !(noTotal || noCursor);
    const allConds = cursorQ ? [...conds, cursorQ] : conds;
    const qVals = cursorArgs ? [...vals || [], ...cursorArgs] : vals;
    const allWhereQ = allConds.length && `WHERE${allConds.map((c) => `(${c})`).join("AND")}`;
    const whereQ = calcTotal && conds.length && `WHERE${conds.map((c) => `(${c})`).join("AND")}`;
    const q = [selectQ, join, allWhereQ, orderQ, limitQ, offsetQ].filter(Boolean).join(" ");
    const totalQ = calcTotal && [`SELECT COUNT(*) as t from (`, selectQ, join, whereQ, ")"].filter(Boolean).join(" ");
    return [q, qVals, cursorColAliases, totalQ, vals, invert];
  }
  /**
   * Search the first matching object.
   *
   * @param {JMSearchAttrs}   attrs      - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<Item | null>} - the result or null if no match.
   */
  async searchOne(attrs, options) {
    const [q, vals] = this.makeSelect({
      attrs,
      ...options,
      limit: 1,
      noCursor: true
    });
    const row = await this.db.get(q, vals);
    return this.toObj(row, options);
  }
  async search(attrs, { itemsOnly, ...options } = {}) {
    const [q, vals, cursorKeys, totalQ, totalVals, invert] = this.makeSelect({
      attrs,
      noCursor: itemsOnly,
      ...options
    });
    const [rows, totalO] = await Promise.all([
      this.db.all(q, vals),
      totalQ && this.db.get(totalQ, totalVals)
    ]);
    if (invert)
      rows.reverse();
    const items = this.toObj(rows, options);
    if (itemsOnly)
      return items;
    let cursor, prevCursor;
    if (rows.length && options?.limit && !options.noCursor) {
      cursor = rows.length === options.limit && (!totalQ || totalO?.t > options.limit) && encodeCursor(rows.at(-1), cursorKeys) || void 0;
      prevCursor = encodeCursor(rows[0], cursorKeys, true);
    }
    return { items, cursor, prevCursor, total: totalO?.t };
  }
  searchAll(attrs, options) {
    return this.search(attrs, { ...options, itemsOnly: true });
  }
  /**
   * Check for existence of objects. Returns `true` if the search would yield
   * results.
   *
   * @returns {Promise<boolean>} The search results exist.
   */
  exists(idOrAttrs, options) {
    if (idOrAttrs && typeof idOrAttrs !== "object") {
      if (this._existsSql?.db !== this.db) {
        const where = this.columns[this.idCol].sql;
        this._existsSql = this.db.prepare(
          `SELECT 1 FROM ${this.quoted} tbl WHERE ${where} = ?`,
          `existsId ${this.name}`
        );
      }
      return this._existsSql.get([idOrAttrs]).then((row) => !!row);
    }
    const [q, vals] = this.makeSelect({
      attrs: idOrAttrs,
      ...options,
      sort: void 0,
      limit: 1,
      offset: void 0,
      noCursor: true,
      cols: ["1"]
    });
    return this.db.get(q, vals).then((row) => !!row);
  }
  /**
   * Count of search results.
   *
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the count.
   */
  count(attrs, options) {
    const [q, vals] = this.makeSelect({
      attrs,
      ...options,
      // When counting from cursor, sort is needed
      // otherwise, sort doesn't help
      sort: options?.cursor ? options.sort : void 0,
      limit: void 0,
      offset: void 0,
      noCursor: true,
      cols: ["COUNT(*) AS c"]
    });
    return this.db.get(q, vals).then((row) => row.c);
  }
  /**
   * Numeric Aggregate Operation.
   *
   * @param {string}          op         - the SQL function, e.g. MAX.
   * @param {JMColName}       colName    - column to aggregate.
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the result.
   */
  numAggOp(op, colName, attrs, options) {
    const col = this.columns[colName];
    const colSql = col && col.sql || colName;
    const o = {
      attrs,
      ...options,
      sort: void 0,
      limit: void 0,
      offset: void 0,
      noCursor: true,
      cols: [`${op}(CAST(${colSql} AS NUMERIC)) AS val`]
    };
    if (col && col.ignoreNull) {
      o.where = { ...o.where, [`${colSql} IS NOT NULL`]: [] };
    }
    const [q, vals] = this.makeSelect(o);
    return this.db.get(q, vals).then((row) => row.val);
  }
  /**
   * Maximum value.
   *
   * @param {JMColName}       colName    - column to aggregate.
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the result.
   */
  max(colName, attrs, options) {
    return this.numAggOp("MAX", colName, attrs, options);
  }
  /**
   * Minimum value.
   *
   * @param {JMColName}       colName    - column to aggregate.
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the result.
   */
  min(colName, attrs, options) {
    return this.numAggOp("MIN", colName, attrs, options);
  }
  /**
   * Sum values.
   *
   * @param {JMColName}       colName    - column to aggregate.
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the result.
   */
  sum(colName, attrs, options) {
    return this.numAggOp("SUM", colName, attrs, options);
  }
  /**
   * Average value.
   *
   * @param {JMColName}       colName    - column to aggregate.
   * @param {JMSearchAttrs}   [attrs]    - simple value attributes.
   * @param {JMSearchOptions} [options]  - search options.
   * @returns {Promise<number>} - the result.
   */
  avg(colName, attrs, options) {
    return this.numAggOp("AVG", colName, attrs, options);
  }
  /**
   * Get all objects.
   *
   * @returns {Promise<Item[]>} - the table contents.
   */
  all() {
    if (this._allSql?.db !== this.db)
      this._allSql = this.db.prepare(
        `SELECT ${this.selectColsSql} FROM ${this.quoted} tbl`,
        `all ${this.name}`
      );
    return this._allSql.all().then(this.toObj);
  }
  /**
   * Get an object by a unique value, like its ID.
   *
   * @param {IDValue} id                    - the value for the column.
   * @param {string}  [colName=this.idCol]  - the columnname, defaults to the ID
   *                                        column.
   * @returns {Promise<Item | null>} - the object if it exists.
   */
  get(id, colName = this.idCol) {
    if (id == null) {
      return Promise.reject(
        new Error(`No id given for "${this.name}.${colName}"`)
      );
    }
    const col = this.columns[colName];
    if (!col)
      return Promise.reject(
        new Error(`Unknown column "${colName}" given for "${this.name}"`)
      );
    if (col._getSql?.db !== this.db) {
      col._getSql = this.db.prepare(
        `SELECT ${this.selectColsSql} FROM ${this.quoted} tbl WHERE ${col.sql} = ?`,
        `get ${this.name}.${colName}`
      );
    }
    return col._getSql.get([id]).then(this.toObj);
  }
  /**
   * Get several objects by their unique value, like their ID.
   *
   * @param {IDValue[]} ids                   - the values for the column.
   * @param {string}    [colName=this.idCol]  - the columnname, defaults to the
   *                                          ID column.
   * @returns {Promise<(Item | null)[]>} - the objects, or null where they don't
   *                                     exist, in order of their requested ID.
   */
  async getAll(ids, colName = this.idCol) {
    let { path, _getAllSql } = this.columns[colName];
    if (_getAllSql?.db !== this.db) {
      const { sql: where, real, get: isSelected } = this.columns[colName];
      if (real && !isSelected)
        throw new Error(
          `JsonModel: Cannot getAll on get:false column ${colName}`
        );
      _getAllSql = this.db.prepare(
        `SELECT ${this.selectColsSql} FROM ${this.quoted} tbl WHERE ${where} IN (SELECT value FROM json_each(?))`,
        `get ${this.name}.${colName}`
      );
      this.columns[colName]._getAllSql = _getAllSql;
    }
    if (!ids?.length)
      return [];
    if (ids.length === 1)
      return [await this.get(ids[0], colName)];
    const rows = await _getAllSql.all([JSON.stringify(ids)]);
    const objs = this.toObj(rows);
    return ids.map((id) => objs.find((o) => lodash.get(o, path) === id));
  }
  _ensureLoader(cache, colName) {
    if (!cache)
      throw new Error(`cache is required`);
    const key = `_DL_${this.name}_${colName}`;
    if (!cache[key]) {
      cache[key] = new DataLoader((ids) => this.getAll(ids, colName), {
        maxBatchSize: 100
      });
    }
    return cache[key];
  }
  getCached(cache, id, colName = this.idCol) {
    if (!cache)
      return this.get(id, colName);
    return this._ensureLoader(cache, colName).load(id);
  }
  /**
   * Lets you clear all the cache or just a key. Useful for when you change only
   * some items.
   *
   * @param {Object} cache                 - the lookup cache. It is managed with
   *                                       DataLoader.
   * @param {ID}     [id]                  - the value for the column.
   * @param {string} [colName=this.idCol]  - the columnname, defaults to the ID
   *                                       column.
   * @returns {Loader} - the actual cache, you can call `.prime(key, value)` on
   *                   it to insert a value.
   */
  clearCache(cache, id, colName = this.idCol) {
    const loader = this._ensureLoader(cache, colName);
    if (id)
      return loader.clear(id);
    return loader.clearAll();
  }
  // I wish I could use these types
  // @typedef {(o: Item) => Promise<void>} RowCallback
  // @typedef {
  // 	(fn: RowCallback) => Promise<void> |
  // 	(attrs: JMSearchAttrs, fn: RowCallback) => Promise<void> |
  // 	(attrs: JMSearchAttrs, options: JMSearchOptions, fn: RowCallback) => Promise<void>
  // } EachFn
  /**
   * Iterate through search results. Calls `fn` on every result.
   * The iteration uses a cursored search, so changes to the model during the
   * iteration can influence the iteration.
   *
   * @param {JMSearchAttrs | RowCallback} attrsOrFn
   * @param {RowCallback | JMSearchOptions} [optionsOrFn]
   * @param {RowCallback} [fn]
   * @returns {Promise<void>} Table iteration completed.
   */
  async each(attrsOrFn, optionsOrFn, fn) {
    if (!fn) {
      if (optionsOrFn) {
        if (typeof optionsOrFn === "function") {
          fn = optionsOrFn;
          optionsOrFn = void 0;
        } else {
          fn = optionsOrFn.fn;
          delete optionsOrFn.fn;
        }
      } else if (typeof attrsOrFn === "function") {
        fn = attrsOrFn;
        attrsOrFn = void 0;
      }
      if (!fn)
        throw new Error("each requires function");
    }
    if (!optionsOrFn)
      optionsOrFn = {};
    const {
      concurrent = 5,
      batchSize = 50,
      limit = batchSize,
      noCursor: _,
      ...rest
    } = optionsOrFn;
    rest.noTotal = true;
    let cursor;
    let i = 0;
    do {
      const result = await this.search(attrsOrFn, { ...rest, limit, cursor });
      cursor = result.cursor;
      await settleAll.settleAll(result.items, async (v) => fn(v, i++), concurrent);
    } while (cursor);
  }
  // --- Mutator methods below ---
  // Contract: All subclasses use set() to store values
  set(...args) {
    return this._set(...args);
  }
  // Change only the given fields, shallowly
  // upsert: also allow inserting
  async updateNoTrans(obj, upsert, noReturn) {
    if (!obj)
      throw new Error("update() called without object");
    const id = obj[this.idCol];
    if (id == null) {
      if (!upsert)
        throw new Error("Can only update object with id");
      return this.set(obj, false, noReturn);
    }
    let prev = await this.get(id);
    if (!upsert && !prev)
      throw new Error(`No object with id ${id} exists yet`);
    if (prev)
      for (const [key, value] of Object.entries(obj)) {
        if (value == null)
          delete prev[key];
        else
          prev[key] = value;
      }
    else
      prev = obj;
    return this.set(prev, false, noReturn);
  }
  /**
   * Update or upsert an object.
   *
   * @param {Object}  obj         The changes to store, including the id field.
   * @param {boolean} [upsert]    Insert the object if it doesn't exist.
   * @param {boolean} [noReturn]  Do not return the stored object.
   * @returns {Promise<Item | undefined>} A copy of the stored object.
   */
  update(obj, upsert, noReturn) {
    if (this.db.inTransaction)
      return this.updateNoTrans(obj, upsert, noReturn);
    return this.db.withTransaction(
      () => this.updateNoTrans(obj, upsert, noReturn)
    );
  }
  /**
   * Remove an object. If the object doesn't exist, this doesn't do anything.
   *
   * @param {ID | Object} idOrObj  The id or the object itself.
   * @returns {Promise<void>} A promise for the deletion.
   */
  remove(idOrObj) {
    const id = typeof idOrObj === "object" ? idOrObj[this.idCol] : idOrObj;
    if (this._deleteSql?.db !== this.db)
      this._deleteSql = this.db.prepare(
        `DELETE FROM ${this.quoted} WHERE ${this.idColQ} = ?`,
        `del ${this.name}`
      );
    return this._deleteSql.run([id]);
  }
  delete(idOrObj) {
    if (warning.DEV)
      warning.deprecated("deleteMethod", "use .remove() instead of .delete()");
    return this.remove(idOrObj);
  }
  /**
   * "Rename" an object.
   *
   * @param {ID} oldId  The current ID. If it doesn't exist this will throw.
   * @param {ID} newId  The new ID. If this ID is already in use this will throw.
   * @returns {Promise<void>} A promise for the rename.
   */
  changeId(oldId, newId) {
    if (newId == null)
      throw new TypeError("newId must be a valid id");
    let { _changeIdSql } = this.columns[this.idCol];
    if (_changeIdSql?.db !== this.db) {
      const { quoted } = this.columns[this.idCol];
      _changeIdSql = this.db.prepare(
        `UPDATE ${this.quoted} SET ${quoted} = ? WHERE ${quoted} = ?`,
        `mv ${this.name}`
      );
      this.columns[this.idCol]._changeIdSql = _changeIdSql;
    }
    return _changeIdSql.run([newId, oldId]).then(({ changes }) => {
      if (changes !== 1)
        throw new Error(`row with id ${oldId} not found`);
      return void 0;
    });
  }
}
module.exports = JsonModelImpl;
