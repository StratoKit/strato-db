"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeMigrations = exports.cloneModelWithDb = void 0;

var _DB = require("../DB");

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const cloneModelWithDb = (m, db) => {
  const model = Object.create(m);
  model.db = db;
  model._set = model._makeSetFn();
  return model;
};

exports.cloneModelWithDb = cloneModelWithDb;

const makeMigrations = ({
  name: tableName,
  idCol,
  columns,
  keepRowId,
  migrations,
  migrationOptions
}) => {
  const tableQuoted = _DB.sql.quoteId(tableName);

  const allMigrations = _objectSpread({}, migrations, {
    // We make id a real column to allow foreign keys
    0: async ({
      db
    }) => {
      const {
        quoted,
        type,
        autoIncrement
      } = columns[idCol];
      const isIntegerId = type === 'INTEGER';
      const addRowId = !isIntegerId && keepRowId; // The NOT NULL is a SQLite bug, otherwise it allows NULL as id

      const rowIdCol = addRowId ? `"rowId" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ` : '';
      const keySql = addRowId ? `${type} NOT NULL` : `${type} PRIMARY KEY ${isIntegerId && autoIncrement ? 'AUTOINCREMENT' : ''} NOT NULL`;
      await db.exec(`CREATE TABLE ${tableQuoted}(${rowIdCol}${quoted} ${keySql}, json JSON);`);

      if (addRowId) {
        // implement the unique constraint with our own index
        await db.exec(`CREATE UNIQUE INDEX ${_DB.sql.quoteId(`${tableName}_${idCol}`)} ON ${tableQuoted}(${_DB.sql.quoteId(idCol)})`);
      }
    }
  });

  for (const [name, col] of Object.entries(columns)) {
    // We already added these, or it's an alias
    if (name === idCol || name === 'json' || name !== col.name) continue;
    const expr = col.sql.replace('tbl.', ''); // Make sure real columns are created before indexes on expressions

    allMigrations[`${col.real ? 0 : 1}_${name}`] = ({
      db
    }) => db.exec(`${col.type ? `ALTER TABLE ${tableQuoted} ADD COLUMN ${col.quoted} ${col.type};` : ''}${col.index ? `CREATE ${col.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${_DB.sql.quoteId(`${tableName}_${name}`)} ON ${tableQuoted}(${expr}) ${col.ignoreNull ? `WHERE ${expr} IS NOT NULL` : ''};` : ''}`);
  } // Wrap the migration functions to provide their arguments


  const wrappedMigrations = {};

  const wrapMigration = migration => {
    const wrap = fn => fn && (writeableDb => {
      if (!writeableDb.store.__madeWriteable) {
        const {
          store
        } = writeableDb;
        writeableDb.store = {
          __madeWriteable: true // Create a patched version of all models that uses the migration db

        };
        Object.values(store).forEach(m => {
          if (typeof m !== 'object') return;
          writeableDb.store[m.name] = cloneModelWithDb(m, writeableDb);
        });
      }

      const model = writeableDb.store[tableName];
      return fn(_objectSpread({}, migrationOptions, {
        db: writeableDb,
        model
      }));
    });

    return wrap(migration.up || migration);
  };

  Object.keys(allMigrations).forEach(k => {
    const m = allMigrations[k];
    if (m) wrappedMigrations[k] = wrapMigration(m);
  });
  return wrappedMigrations;
};

exports.makeMigrations = makeMigrations;
//# sourceMappingURL=makeMigrations.js.map