const DEV = process.env.NODE_ENV !== "production";
let deprecated, unknown;
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
  deprecated = warner("DEPRECATED");
  unknown = warner("UNKNOWN");
} else {
  deprecated = () => {
  };
  unknown = () => {
  };
}
export {
  DEV,
  deprecated,
  unknown
};
