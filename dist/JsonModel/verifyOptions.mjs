import PropTypes from "prop-types";
const columnPropType = process.env.NODE_ENV === "production" ? null : PropTypes.exact({
  // === sql column ===
  real: PropTypes.bool,
  // column type if real column
  type: PropTypes.oneOf([
    "TEXT",
    "NUMERIC",
    "INTEGER",
    "REAL",
    "BLOB",
    "JSON"
  ]),
  path: PropTypes.string,
  autoIncrement: PropTypes.bool,
  alias: PropTypes.string,
  get: PropTypes.bool,
  parse: PropTypes.func,
  stringify: PropTypes.func,
  alwaysObject: PropTypes.bool,
  // === value related ===
  slugValue: PropTypes.func,
  sql: PropTypes.string,
  value: PropTypes.func,
  default: PropTypes.any,
  required: PropTypes.bool,
  falsyBool: PropTypes.bool,
  // === index ===
  // create index for this column
  index: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
  ignoreNull: PropTypes.bool,
  unique: PropTypes.bool,
  // === queries ===
  where: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
  whereVal: PropTypes.func,
  // === query helpers ===
  in: PropTypes.bool,
  inAll: PropTypes.bool,
  isAnyOfArray: PropTypes.bool,
  isArray: PropTypes.bool,
  textSearch: PropTypes.bool
});
const verifyColumn = (name, column) => {
  if (process.env.NODE_ENV !== "production") {
    const prevError = console.error;
    console.error = (message) => {
      console.error = prevError;
      throw new Error(message);
    };
    PropTypes.checkPropTypes(
      { column: columnPropType },
      { column },
      `column`,
      "JsonModel"
    );
    console.error = prevError;
  }
};
const jmPropTypes = process.env.NODE_ENV === "production" ? null : {
  options: PropTypes.exact({
    db: PropTypes.object.isRequired,
    name: PropTypes.string.isRequired,
    migrations: PropTypes.objectOf(
      PropTypes.oneOfType([
        PropTypes.oneOf([false]),
        PropTypes.func,
        PropTypes.exact({ up: PropTypes.func, down: PropTypes.func })
      ])
    ),
    migrationOptions: PropTypes.object,
    columns: PropTypes.objectOf(
      PropTypes.oneOfType([PropTypes.func, columnPropType])
    ),
    ItemClass: PropTypes.func,
    idCol: PropTypes.string,
    keepRowId: PropTypes.bool,
    // Harmless props passed by ESDB
    dispatch: PropTypes.any,
    emitter: PropTypes.any
  })
};
const verifyOptions = (options) => {
  if (process.env.NODE_ENV !== "production") {
    const prevError = console.error;
    console.error = (message) => {
      console.error = prevError;
      throw new Error(message);
    };
    PropTypes.checkPropTypes(jmPropTypes, { options }, "options", "JsonModel");
    console.error = prevError;
  }
};
export {
  columnPropType,
  verifyColumn,
  verifyOptions
};
