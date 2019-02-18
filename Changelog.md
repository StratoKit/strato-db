# Changelog

## 2.3.1

- JsonModel
  - refactor: split in multiple files
  - change array queries so they can be prepared
  - fix expression index creation before column
- EventQueue: test before calling timer.unref()
- build: Upgrade to Babel 7 and latest ESLint

## 2.3.0

Minor version change due to index changes on queue for ESDB

- DB: add filename and stack to SQLite errors
- JsonModel: allow thunking definitions, that way you can create helpers to define columns
- JsonModel: add `.each([attrs, [options]], fn)` to iterate over search results
  `fn(row, i)` will be called with row data and row number
- EventSourcingDB: `withViews = true` option to add the helper views to the queue
- EventQueue: drop the `type` index and use `type, size`; always add `size` column

## 2.2.3

- EventQueue: Ensure that queue insertions maintain their order
- DB/EventSourcingDB: Fix `readOnly` mode and add test

## 2.2.2

- First public release!
- EventSourcingDB: the metadata table can be used as well
- EventQueue: don't keep Node alive while waiting unless `forever: true`

## 2.2.1

- JsonModel: value() on non-real columns is now stored

## 2.2.0

JsonModel:

- `column.alwaysObject`: for JSON columns: always have an object at that path, and store empty objects as NULL
- `column.falsyBool`: store booleanish value as true/undefined. `real:true` makes the column be integer type
  querying also works with truthy and falsy values

## 2.1.0

JsonModel:

- `column.where(val, origVal)`: Now the original value is also available to the `where` function
- fix json column detection for non-JSON columns

## 2.0.0

JsonModel: breaking API change

- `jsonPath` is now `path` and defaults to column name
- Columns can be real or virtual
- Real columns are put where `path` wants it
- `value` can always be used to calculate field values, for real and virtual columns
- `parse` and `stringify` convert values from/to database values
- you can nest column parsing etc, it will run them in the right order

To upgrade:

- delete `jsonPath` where it's the same as the column name
- rename `jsonPath` to `path`
- delete `value` where it's just extracting the same field as the column name, replace with `type` (and indicate the column type) or `real: true`
- `get` is now `true` by default, so remove it when true and set it to `false` when missing

## 1.4.0

- JsonModel: stricter options with better type checking
- EventQueue: add \_recentHistory and \_historyTypes views for debugging

## 1.3.0

- ESModel: add metadata to event data on index 3

## 1.2.0

- JsonModel: `required` flag on column makes sure the result of value() is non-null and sets allowNull to false for proper indexing

## 1.1.0

- Directly depend on mapbox/sqlite3 by copying the relevant code from kriasoft/sqlite
- Remove Bluebird dependency
