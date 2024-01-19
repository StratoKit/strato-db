"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
require("../DB/DB.js");
const SQLite = require("../DB/SQLite.js");
const slugify = require("../lib/slugify.js");
const lodash = require("lodash");
const normalizeColumn = (col, name) => {
  col.name = name;
  col.quoted = SQLite.sql.quoteId(name);
  if (col.type)
    col.real = true;
  else if (col.real)
    col.type = col.falsyBool ? "INTEGER" : "BLOB";
  if (col.get == null)
    col.get = !!col.real;
  if (!col.path && name !== "json")
    col.path = name;
  col.parts = col.path === "" ? [] : col.path.split(".");
  if (col.index === "ALL")
    col.ignoreNull = false;
  if (col.index === "SPARSE")
    col.ignoreNull = true;
  if (col.unique) {
    if (!col.index)
      throw new TypeError(`${name}: unique requires index`);
  } else if (col.ignoreNull == null) {
    col.ignoreNull = true;
  }
  if (col.autoIncrement && col.type !== "INTEGER")
    throw new TypeError(`${name}: autoIncrement is only for type INTEGER`);
  if (col.slugValue) {
    if (col.value)
      throw new TypeError(`${name}: slugValue and value can't both be defined`);
    if (!col.index)
      throw new TypeError(`${name}: slugValue requires index`);
    col.value = async function(o) {
      if (o[name] != null)
        return o[name];
      return slugify.uniqueSlugId(this, await col.slugValue(o), name, o[this.idCol]);
    };
  }
  if (col.default != null) {
    col.ignoreNull = false;
    const prev = col.value;
    if (prev) {
      col.value = async function(o) {
        const r = await prev.call(this, o);
        return r == null ? col.default : r;
      };
    } else if (col.sql) {
      col.sql = `ifNull(${col.sql},${SQLite.valToSql(col.default)})`;
    } else {
      col.value = (o) => {
        const v = lodash.get(o, col.path);
        return v == null ? col.default : v;
      };
    }
  }
  if (col.required) {
    col.ignoreNull = false;
    const prev = col.value;
    col.value = prev ? async function(o) {
      const r = await prev.call(this, o);
      if (r == null)
        throw new Error(`${name}: value is required`);
      return r;
    } : (o) => {
      const v = lodash.get(o, col.path);
      if (v == null)
        throw new Error(`${name}: value is required`);
      return v;
    };
  }
  if (col.falsyBool) {
    const prev = col.value;
    col.value = prev ? async function(o) {
      const r = await prev.call(this, o);
      return r ? true : void 0;
    } : (o) => {
      const v = lodash.get(o, col.path);
      return v ? true : void 0;
    };
    if (col.real) {
      if (col.parse)
        throw new TypeError(`${name}: falsyBool can't have parse`);
      col.parse = (v) => v ? true : void 0;
    }
  }
  if (!col.real && col.stringify)
    throw new Error(`${name}: stringify only applies to real columns`);
  if (!col.get && col.parse)
    throw new Error(`${name}: parse only applies to get:true columns`);
};
exports.normalizeColumn = normalizeColumn;
