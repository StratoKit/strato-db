"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const asyncSema = require("async-sema");
const settleAll = async (items, fn, maxConcurrent) => {
  let err, cb;
  if (maxConcurrent) {
    const sema = new asyncSema.Sema(maxConcurrent);
    cb = async (item) => {
      await sema.acquire();
      try {
        return await fn(item);
      } finally {
        sema.release();
      }
    };
  } else {
    cb = fn;
  }
  await Promise.all(
    items.map(async (i) => {
      try {
        await cb(i);
      } catch (error) {
        err = error;
      }
    })
  );
  if (err)
    throw err;
};
exports.settleAll = settleAll;
