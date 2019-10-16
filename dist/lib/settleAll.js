"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.settleAll = void 0;

// Only throw after all items are processed
const settleAll = async (items, fn) => {
  let err;
  await Promise.all(items.map(async i => {
    try {
      await fn(i);
    } catch (error) {
      // last one wins
      err = error;
    }
  }));
  if (err) throw err;
};

exports.settleAll = settleAll;
//# sourceMappingURL=settleAll.js.map