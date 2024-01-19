import { byPathLengthDesc } from "./prepareSqlCol.mjs";
const assignJsonParents = (columnArr) => {
  const parents = columnArr.filter((c) => c.type === "JSON" && c.get).sort(byPathLengthDesc);
  for (const col of columnArr) {
    const parent = parents.find(
      (p) => !p.path || col.path.startsWith(p.path + ".")
    );
    if (parent.alwaysObject == null)
      parent.alwaysObject = true;
    if (!col.real) {
      col.jsonCol = parent.name;
      col.jsonPath = parent.path ? col.path.slice(parent.path.length + 1) : col.path;
    }
  }
};
export {
  assignJsonParents
};
