"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.verifyOptions = exports.verifyColumn = exports.columnPropType = void 0;

var _propTypes = _interopRequireDefault(require("prop-types"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @typedef ColumnDef
 * @type {Object}
 * @property {boolean} [real=!!type] - is this a real table column
 * @property {string} [type] - sql column type as accepted by {@link DB}
 * @property {string} [path] - path to the value in the object
 * @property {boolean} [autoIncrement] - INTEGER id column only: apply AUTOINCREMENT on the column
 * @property {string} [alias] - the alias to use in SELECT statements
 * @property {boolean} [get=true] - should the column be included in search results
 * @property {function} [parse] - process the value after getting from DB
 * @property {function} [stringify] - process the value before putting into DB
 * @property {boolean} [alwaysObject] - the value is an object and must always be there. If this is a real column, a NULL column value will be replaced by `{}` and vice versa.
 * @property {function} [value] - function getting object and returning the value for the column; this creates a real column. Right now the column value is not regenerated for existing rows.
 * @property {function} [slugValue] - same as value, but the result is used to generate a unique slug
 * @property {string} [sql] - any sql expression to use in SELECT statements
 * @property {*} [default] - if the value is nullish, this will be stored instead
 * @property {boolean} [required] - throw when trying to store a NULL
 * @property {boolean} [falsyBool] - store/retrieve this boolean value as either `true` or absent from the object
 * @property {boolean} [index] - should it be indexed? If `unique` is false, NULLs are never indexed
 * @property {boolean} [ignoreNull=!unique] - are null values ignored in the index?
 * @property {boolean} [unique] - should the index enforce uniqueness?
 * @property {function} [whereVal] - a function returning the `vals` give to `where`. It should return falsy or an array of values.
 * @property {(string|function)} [where] - the where clause for querying, or a function returning one given `(vals, origVals)`
 * @property {boolean} [isArray] - this column contains an array of values
 * @property {boolean} [in] - to query, this column value must match one of the given array items
 * @property {boolean} [inAll] - [isArray only] to query, this column value must match all of the given array items
 * @property {boolean} [textSearch] - perform searches as substring search with LIKE
 * @property {boolean} [isAnyOfArray] - alias for isArray+inAll
 */
const columnPropType = process.env.NODE_ENV === 'production' ? null : _propTypes.default.exact({
  // === sql column ===
  real: _propTypes.default.bool,
  // column type if real column
  type: _propTypes.default.oneOf(['TEXT', 'NUMERIC', 'INTEGER', 'REAL', 'BLOB', 'JSON']),
  path: _propTypes.default.string,
  autoIncrement: _propTypes.default.bool,
  alias: _propTypes.default.string,
  get: _propTypes.default.bool,
  parse: _propTypes.default.func,
  stringify: _propTypes.default.func,
  alwaysObject: _propTypes.default.bool,
  // === value related ===
  slugValue: _propTypes.default.func,
  sql: _propTypes.default.string,
  value: _propTypes.default.func,
  default: _propTypes.default.any,
  required: _propTypes.default.bool,
  falsyBool: _propTypes.default.bool,
  // === index ===
  // create index for this column
  index: _propTypes.default.oneOfType([_propTypes.default.bool, _propTypes.default.string]),
  ignoreNull: _propTypes.default.bool,
  unique: _propTypes.default.bool,
  // === queries ===
  where: _propTypes.default.oneOfType([_propTypes.default.string, _propTypes.default.func]),
  whereVal: _propTypes.default.func,
  // === query helpers ===
  in: _propTypes.default.bool,
  inAll: _propTypes.default.bool,
  isAnyOfArray: _propTypes.default.bool,
  isArray: _propTypes.default.bool,
  textSearch: _propTypes.default.bool
});
exports.columnPropType = columnPropType;

const verifyColumn = (name, column) => {
  if (process.env.NODE_ENV !== 'production') {
    /* eslint-disable no-console */
    const prevError = console.error;

    console.error = message => {
      console.error = prevError;
      throw new Error(message);
    };

    _propTypes.default.checkPropTypes({
      column: columnPropType
    }, {
      column
    }, `column`, 'JsonModel');

    console.error = prevError;
    /* eslint-enable no-console */
  }
};
/**
 * @typedef JMOptions
 * @type {Object}
 * @property {DB} db - a DB instance, normally passed by DB
 * @property {string} name - the table name
 * @property {Object} [migrations] - an object with migration functions. They are ran in alphabetical order
 * @property {Object} [migrationOptions] - free-form data passed to the migration functions
 * @property {Object} [columns] - the column definitions as {@link ColumnDef} objects. Each value must be a columndef or a function returning a columndef.
 * @property {function} [ItemClass] - an object class to use for results, must be able to handle `Object.assign(item, result)`
 * @property {string} [idCol='id'] - the key of the ID column
 * @property {boolean} [keepRowId] - preserve row id after vacuum
 */


exports.verifyColumn = verifyColumn;
const jmPropTypes = process.env.NODE_ENV === 'production' ? null : {
  options: _propTypes.default.exact({
    db: _propTypes.default.object.isRequired,
    name: _propTypes.default.string.isRequired,
    migrations: _propTypes.default.objectOf(_propTypes.default.oneOfType([_propTypes.default.oneOf([false]), _propTypes.default.func, _propTypes.default.exact({
      up: _propTypes.default.func,
      down: _propTypes.default.func
    })])),
    migrationOptions: _propTypes.default.object,
    columns: _propTypes.default.objectOf(_propTypes.default.oneOfType([_propTypes.default.func, columnPropType])),
    ItemClass: _propTypes.default.func,
    idCol: _propTypes.default.string,
    keepRowId: _propTypes.default.bool,
    // Harmless props passed by ESDB
    dispatch: _propTypes.default.any,
    emitter: _propTypes.default.any
  })
};

const verifyOptions = options => {
  if (process.env.NODE_ENV !== 'production') {
    /* eslint-disable no-console */
    const prevError = console.error;

    console.error = message => {
      console.error = prevError;
      throw new Error(message);
    };

    _propTypes.default.checkPropTypes(jmPropTypes, {
      options
    }, 'options', 'JsonModel');

    console.error = prevError;
    /* eslint-enable no-console */
  }
};

exports.verifyOptions = verifyOptions;
//# sourceMappingURL=verifyOptions.js.map