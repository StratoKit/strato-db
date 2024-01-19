"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const lodash = require("lodash");
const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomString = (n) => (
  // eslint-disable-next-line unicorn/no-new-array
  Array.apply(null, new Array(n)).map(() => {
    return abc.charAt(Math.floor(Math.random() * abc.length));
  }).join("")
);
const slugifyString = (name, alwaysResult) => {
  const t = typeof name === "string" ? name : typeof name === "number" ? name.toString() : name && typeof name === "object" ? Object.values(name).find((v) => typeof v === "string" && v) : null;
  if (!t) {
    if (alwaysResult)
      return randomString(12);
    throw new Error(`Cannot slugify ${name}`);
  }
  return encodeURIComponent(lodash.deburr(t).trim()).replaceAll(/(%..|['()_~])/g, "-").replaceAll(/--+/g, "-").toLowerCase().replaceAll(/(^[^\da-z]+|[^\da-z]+$)/g, "").slice(0, 30);
};
const uniqueSlugId = async (model, name, colName, currentId) => {
  const slug = slugifyString(name, true);
  let id = slug;
  let i = 1;
  const where = currentId && {
    [`${model.idColQ} IS NOT ?`]: [currentId]
  };
  while (await model.exists({ [colName]: id }, { where })) {
    id = `${slug}-${++i}`;
  }
  return id;
};
exports.randomString = randomString;
exports.slugifyString = slugifyString;
exports.uniqueSlugId = uniqueSlugId;
