"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.uniqueSlugId = exports.slugifyString = exports.randomString = void 0;

var _deburr2 = _interopRequireDefault(require("lodash/deburr"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';

const randomString = n => Array.apply(null, new Array(n)) // eslint-disable-line prefer-spread
.map(() => {
  return abc.charAt(Math.floor(Math.random() * abc.length));
}).join('');

exports.randomString = randomString;

const slugifyString = (name, alwaysResult) => {
  // extract name from i18n objects
  const t = typeof name === 'string' ? name : typeof name === 'number' ? name.toString() : name && typeof name === 'object' ? Object.values(name).find(v => typeof v === 'string' && v) : null;

  if (!t) {
    if (alwaysResult) return randomString(12);
    throw new Error(`Cannot slugify ${name}`);
  }

  return encodeURIComponent((0, _deburr2.default)(t).trim()).replace(/(%..|[()'_~])/g, '-').replace(/--+/g, '-').toLowerCase().replace(/(^[^a-z0-9]+|[^a-z0-9]+$)/g, '').slice(0, 30);
}; // This is not race-safe - only use for write-seldomn things like backoffice or inside transactions


exports.slugifyString = slugifyString;

const uniqueSlugId = async (model, name, colName, currentId) => {
  const slug = slugifyString(name, true);
  let id = slug;
  let i = 1;
  const where = currentId && {
    [`${model.idColQ} IS NOT ?`]: [currentId] // eslint-disable-next-line no-await-in-loop

  };

  while (await model.exists({
    [colName]: id
  }, {
    where
  })) {
    id = `${slug}-${++i}`;
  }

  return id;
};

exports.uniqueSlugId = uniqueSlugId;
//# sourceMappingURL=slugify.js.map