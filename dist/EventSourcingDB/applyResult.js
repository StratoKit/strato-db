"use strict";
const warning = require("../lib/warning.js");
const settleAll = require("../lib/settleAll.js");
const applyResult = async (model, result) => {
  const { rm, set, ins, upd, sav } = result;
  if (warning.DEV) {
    const { rm: rm2, set: set2, ins: ins2, upd: upd2, sav: sav2, ...rest } = result;
    for (const k of Object.keys(rest))
      if (typeof rest[k] !== "undefined")
        warning.unknown(k, `key ${k} in result`);
  }
  if (rm)
    await settleAll.settleAll(rm, (item) => model.remove(item));
  if (ins)
    await settleAll.settleAll(ins, (obj) => model.set(obj, true, true));
  if (set)
    await settleAll.settleAll(set, (obj) => model.set(obj, false, true));
  if (upd)
    await settleAll.settleAll(upd, (obj) => model.updateNoTrans(obj, true, true));
  if (sav)
    await settleAll.settleAll(sav, (obj) => model.updateNoTrans(obj, false, true));
};
module.exports = applyResult;
