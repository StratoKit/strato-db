"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeIdValue = void 0;

var _uuid = _interopRequireDefault(require("uuid"));

var _slugify = require("../lib/slugify");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const makeDefaultIdValue = idCol => obj => {
  if (obj[idCol] != null) return obj[idCol];
  return _uuid.default.v1();
};

const makeIdValue = (idCol, {
  value,
  slugValue,
  type
} = {}) => {
  if (type === 'INTEGER') {
    return value ? value : o => {
      const id = o[idCol];
      return id || id === 0 ? id : null;
    };
  } // do not bind the value functions, they must be able to use other db during migrations


  if (slugValue) {
    return async function (o) {
      if (o[idCol] != null) return o[idCol];
      return (0, _slugify.uniqueSlugId)(this, (await slugValue(o)), idCol);
    };
  }

  const defaultIdValue = makeDefaultIdValue(idCol);

  if (value) {
    return async function (o) {
      if (o[idCol] != null) return o[idCol];
      const id = await value.call(this, o);
      return id == null ? defaultIdValue(o) : id;
    };
  }

  return defaultIdValue;
};

exports.makeIdValue = makeIdValue;
//# sourceMappingURL=makeDefaultIdValue.js.map