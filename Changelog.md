# Changelog

## Unreleased

### Breaking

The following is a very insignificant breaking change so doesn't warrant a new major version.

- EventQueue: `.setKnownV()` is now synchronous and no longer returns a Promise

### Changes

- ESDB: Renamed `dispatch()` to `addEvent()` inside the event processing flow. `dispatch()` still works but gives a deprecation warning. The `.dispatch()` method is not affected.
- SQLite: added `.runOnceOnOpen()` to register functions that should be run on the open database but shouldn't open the database
- ESDB: Added `transact({event, model, store, dispatch})` phase to the event processing flow. In this callback, you can call `dispatch` to generate sub-events, and calling ESModel will work too (any model can use the `dispatch` given via the constructor).
  This requires the use of `AsyncLocalStorage`, and thus the minimum NodeJS version is now v12.17
- ESDB: `dispatch({type, data, ts})` is now also possible

## 3.1.1

- ESModel - `getNextId()` fix (was returning incorrect values when run inside a subevent)

## 3.1.0

### Breaking

- The `cache` argument to `JsonModel.clearCache(cache, [id], [colName])` is no longer optional, and the method will now always return the `DataLoader` instance

### Changes

- Added TypeScript types generated from the JSDoc, and improved some definitions
- There was a deadlock in some circumstances where the initialization of ESModel could wait on the EventQueue and vice versa
- `JsonModel.getAll(ids, [colName])` now optimizes getting 0 and 1 objects

## 3.0.0

### Breaking

- The package builds for NodeJS v10 now.
- EventSourcingDB events that result in errors now halt processing and have to be fixed before processing continues
- `waitForP` was removed from DB, use `onWillOpen` instead, if it returns a Promise that will be waited for.
- The EventSourcingDB version is now stored in the SQLite `user_version` pragma, and the `metadata` model is no longer available by default. If you need it, add `metadata: {}` to the `models` passed to ESDB
- `DB.models` was renamed to `DB.store` for consistency with ESDB and also to be different from the `models` option. `DB.models` still works but will output an error on first use in non-production.
- The `result` argument passed to derivers is now the result of the deriver's model. All results are still available at `event.result`
- DB connections now set `PRAGMA recursive_triggers`
- In NODE_ENV=development, the order of unordered query results will sometimes be reversed to show where ordering is not consistent. In test this is not done since the ordering is always the same and used in snapshots etc.
- The `meta` argument in ESModel `.set` and `.update` moved to 4th position to make room for `noResult`
- EventSourcingDB no longer checks for pending events when instantiated. You have to do this yourself with `.checkForEvents()` or simply `.startPolling()`
- DB no longer returns itself on `.exec()`. There's no reason for having it and it saves some GC work.
- `.applyChanges(result)` was renamed to `.applyResult(result)`
- the debug namespace was changed to `strato-db`
- `applyChanges` was moved from JsonModel to a separate helper function `applyResult(model, result)`
- EventSourcingDB now passes `emitter` as an option to models, so they can subscribe to events. You have to take it out before passing the options to `JsonModel`.
- Migration metadata is now stored in the table `{sdb} migrations` instead of `_migrations`. There is a migration procedure, but don't open your DBs with previous versions of strato-db, since the old versions will try to run the migrations again (and fail, so the data is safe).

### Deprecated

- reducers are now called with a single `{model, event, store, dispatch, isMainEvent}` object like preprocessor and deriver. Old reducers with multiple arguments are automatically wrapped and result in a deprecation message

### Changes

- EventSourcingDB refactor:
  - sub-events! You can dispatch events during events; they are handled depth-first in the same transaction. If any result in error, they error the parent event
  - make error handling more robust
  - simplify redux loop
  - retry failed events with increasing timeouts and exit program after an hour
- ESModel will now emit a `${model.INIT}` event to allow setting up the table, if you pass `init: true`
- DB, JsonModel, EventSourcingDB: Better debugging information for queries and errors
- DB: split into SQlite and the migrations-adding DB
- SQlite: add `autoVacuum` option, sets up incremental vacuuming. If there are > 20x `vacuumPageCount` free pages, it will free `vacuumPageCount` pages every `vacuumInterval` seconds. Defaults to 1MB (of 4KB pages) and 30s.
- SQlite: limit WAL file size after transaction to 4MB
- SQlite: run `PRAGMA optimize` every 2 hours
- SQlite: emit `'begin'`, `'rollback'`, `'end'`, `'finally'` on transactions as EventEmitter
- JsonModel: `.set` and `.update` take the `noReturn` boolean as their 3rd argument to indicate they don't have to return the value, as an optimization
- SQLite: add `.inTransaction` boolean that indicates if `withTransaction` is active
- JsonModel: `.update` reuses a running `withTransaction`, so there is probably never a reason to use `.updateNoTrans`
- EventQueue: `.latestVersion()` is deprecated in favor of `.getMaxV()`
- JsonModel: if the id column is not an integer type (which means that sqlite uses it as the `rowId`), `rowId` will be added as a column. This ensures that the VACUUM command doesn't change the `rowid`s so that references to them won't become invalid. To disable this you can pass `keepRowId: false` to JsonModel.
- EventSourcingDB: provide a `cache` object to the preprocessor and reducer, which can be used to optimize data fetching. The cache is shared and only valid during the read-only phase of the event handling

## 2.3.3

- JsonModel: fix using columns with paths in `getAll`

## 2.3.2

- JsonModel: don't error on existing indexes

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
