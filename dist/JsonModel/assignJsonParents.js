"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.assignJsonParents = void 0;

var _prepareSqlCol = require("./prepareSqlCol");

const assignJsonParents = columnArr => {
  const parents = columnArr.filter(c => c.type === 'JSON' && c.get).sort(_prepareSqlCol.byPathLengthDesc);

  for (const col of columnArr) {
    // Will always match, json column has path:''
    const parent = parents.find(p => !p.path || col.path.startsWith(p.path + '.'));
    if (parent.alwaysObject == null) parent.alwaysObject = true;

    if (!col.real) {
      col.jsonCol = parent.name;
      col.jsonPath = parent.path ? col.path.slice(parent.path.length + 1) : col.path;
    }
  }
};

exports.assignJsonParents = assignJsonParents;
//# sourceMappingURL=assignJsonParents.js.map