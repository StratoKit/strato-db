"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.unknown = exports.deprecated = exports.DEV = void 0;
const DEV = process.env.NODE_ENV !== 'production';
exports.DEV = DEV;
let deprecated, unknown;
exports.unknown = unknown;
exports.deprecated = deprecated;

if (DEV) {
  const warned = {};

  const warner = type => (tag, msg) => {
    if (warned[tag]) return;
    warned[tag] = true; // eslint-disable-next-line no-console

    console.error(new Error(`!!! ${type} ${msg}`));
  };

  exports.deprecated = deprecated = warner('DEPRECATED');
  exports.unknown = unknown = warner('UNKNOWN');
}
//# sourceMappingURL=warning.js.map