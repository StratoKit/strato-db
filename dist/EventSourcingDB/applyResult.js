"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _warning = require("../lib/warning");

var _settleAll = require("../lib/settleAll");

function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

const applyResult = async (model, result) => {
  const {
    rm,
    set,
    ins,
    upd,
    sav
  } = result;

  if (_warning.DEV) {
    const {
      rm,
      set,
      ins,
      upd,
      sav
    } = result,
          rest = _objectWithoutProperties(result, ["rm", "set", "ins", "upd", "sav"]);

    Object.keys(rest).forEach(k => typeof rest[k] !== 'undefined' && (0, _warning.unknown)(k, `key ${k} in result`));
  }

  if (rm) await (0, _settleAll.settleAll)(rm, item => model.remove(item));
  if (ins) await (0, _settleAll.settleAll)(ins, obj => model.set(obj, true, true));
  if (set) await (0, _settleAll.settleAll)(set, obj => model.set(obj, false, true));
  if (upd) await (0, _settleAll.settleAll)(upd, obj => model.updateNoTrans(obj, true, true));
  if (sav) await (0, _settleAll.settleAll)(sav, obj => model.updateNoTrans(obj, false, true));
};

var _default = applyResult;
exports.default = _default;
//# sourceMappingURL=applyResult.js.map