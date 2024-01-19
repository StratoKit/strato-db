"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const DEV = process.env.NODE_ENV !== "production";
exports.deprecated = void 0;
exports.unknown = void 0;
if (DEV) {
  const warned = {};
  const warner = (type) => (tag, msg, conditionFn) => {
    if (warned[tag])
      return;
    if (conditionFn && !conditionFn())
      return;
    warned[tag] = true;
    console.warn(new Error(`!!! ${type} ${msg}`));
  };
  exports.deprecated = warner("DEPRECATED");
  exports.unknown = warner("UNKNOWN");
} else {
  exports.deprecated = () => {
  };
  exports.unknown = () => {
  };
}
exports.DEV = DEV;
