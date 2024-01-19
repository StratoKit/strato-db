import { DEV, unknown } from "../lib/warning.mjs";
import { settleAll } from "../lib/settleAll.mjs";
const applyResult = async (model, result) => {
  const { rm, set, ins, upd, sav } = result;
  if (DEV) {
    const { rm: rm2, set: set2, ins: ins2, upd: upd2, sav: sav2, ...rest } = result;
    for (const k of Object.keys(rest))
      if (typeof rest[k] !== "undefined")
        unknown(k, `key ${k} in result`);
  }
  if (rm)
    await settleAll(rm, (item) => model.remove(item));
  if (ins)
    await settleAll(ins, (obj) => model.set(obj, true, true));
  if (set)
    await settleAll(set, (obj) => model.set(obj, false, true));
  if (upd)
    await settleAll(upd, (obj) => model.updateNoTrans(obj, true, true));
  if (sav)
    await settleAll(sav, (obj) => model.updateNoTrans(obj, false, true));
};
export {
  applyResult as default
};
