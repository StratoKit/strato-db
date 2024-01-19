import { v1 } from "uuid";
import { uniqueSlugId } from "../lib/slugify.mjs";
const makeDefaultIdValue = (idCol) => (obj) => {
  if (obj[idCol] != null)
    return obj[idCol];
  return v1();
};
const makeIdValue = (idCol, { value, slugValue, type } = {}) => {
  if (type === "INTEGER") {
    return value ? value : (o) => {
      const id = o[idCol];
      return id || id === 0 ? id : null;
    };
  }
  if (slugValue) {
    return async function(o) {
      if (o[idCol] != null)
        return o[idCol];
      return uniqueSlugId(this, await slugValue(o), idCol);
    };
  }
  const defaultIdValue = makeDefaultIdValue(idCol);
  if (value) {
    return async function(o) {
      if (o[idCol] != null)
        return o[idCol];
      const id = await value.call(this, o);
      return id == null ? defaultIdValue(o) : id;
    };
  }
  return defaultIdValue;
};
export {
  makeIdValue
};
