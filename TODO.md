# TODO list

## General

- use JSDoc to move types back to implementations as much as possible, so subclassing etc works
  - probably everything we need is covered by JSDoc now
- allow using https://github.com/rqlite/rqlite-js as a backend for a distributed DB
- Change the multi-access tests to use `"file:memdb1?mode=memory&cache=shared"` for shared access to the same in-memory db (probably when using better-sqlite, it requires file uri support)
- Give DB and ESDB the same API for registering models (.addModel)
- Optimize:
  - [ ] create benchmark
  - [ ] API to get prepared statements from JM .search
- Some mechanism to quit running processes when the schema changes. Maybe store a user-defined schema version in `PRAGMA application_id`? Isn't nice to have to check it every time data_version changes though :(

## node-sqlite3

### Someday

- [ ] sync interface for e.g. pragma data_version and BEGIN IMMEDIATE. Already did some work on it but it segfaults. Alternatively, use better-sqlite in a worker

## SQLite

### Important

- [ ] when opening, handle the error `{code: 'SQLITE_CANTOPEN'}` by retrying later

### Nice to have

- [ ] event emitter proxying the sqlite3 events
- [ ] `ensureTable(columns)`: accept column defs and create/add if needed, using pragma table_info

  ```text
  > pragma table_info("_migrations");
  cid|name|type|notnull|dflt_value|pk
  0|runKey|STRING|0||0
  1|ts|DATETIME|0||0
  2|up|BOOLEAN|0||0
  ```

- [ ] `ensureIndexes(indexes, dropUnused)` manage indexes, using PRAGMA index*list. Drop unused indexes with `\_sdb*` prefix
- [ ] create a worker thread version that uses better-sqlite. Benchmark.
- [ ] support better-sqlite if it's ok for the main thread to hang

### Someday

- [ ] use the btree info extension to provide index sizes at startup if debug enabled
- [ ] async iterators for `db.each()`. Although node-sqlite3 actually slurps the entire table into an array so it would only be useful for better-sqlite

## DB

### Nice to have

- [ ] if migration is `{undo:fn}` run the `undo` only if the migration ran before. We never needed `down` migrations so far.
  - if you want to run something only on existing databases, first deploy a no-op `()=>{}` migration and then change it to an `undo`

## JsonModel

### Important

- [ ] .each() limit should apply to total fetched, breaking change
- FTS5 support for text searching on columns
  - It uses the table as a backing table
  - Real columns marked `fts: true|object` generate a FTS5 index
    - `true` is shorthand for `{group: 'all', allColumns: false}`
    - `group` is a name for the index so you can group columns in separate indexes, for example by language
    - `allColumns`, if true, means to search all columns for this group. This can be used on non-real columns
    - Content columns have to be real columns, otherwise FTS5 can't refer to them. So, throw an error if the column not real except if `allColumns: true`.
    - `textSearch: true` should be deprecated and means `fts: {group: 'all'}` if `real: true`
    - other options could be added to configure tokenizing
  - one index per `fts.group` value (, defaults to `'all'`)
  - Searching passes the search argument to the FTS5 index of the group
    - The search is limited to the column unless `allColumns: true`
  - ¿Updates to the FTS index are applied by JsonModel, not triggers? why/why not
- [ ] columns using the same path should get the same JSON path. There are some edge cases.
- [ ] falsyBool paging doesn't work because it tries to >= and that fails for null. It should add a "sortable: false" flag

### Nice to have

- [ ] removeFalsy column decorator: remove falsy elements (except '' and 0) from JSON before storing
- [ ] validate(value): must return truthy given the current value (from path or value()) or storing throws
- [ ] column.version: defaults to 1. When version increases, all rows are rewritten
  - do not change extra columns, that is what migrations are for
- [ ] recreate index if expression changes
- [ ] indexes: `[{expression, where}]` extra indexes
  - [ ] auto-delete other indexes, API change
- column helpers:
  - [ ] objectColumn() helper -> type=JSON, NULL === {}, stringify checks if object (char 0 is `{`)
  - [ ] boolColumn() -> `type="INTEGER"; parse = Boolean; stringify=Boolean`
  - [ ] falsyColumn() -> implement falsyBool
    - note that `col.where = (${col.sql} IS NULL)=?` doesn't need a where function but won't use a sparse index.
      So maybe, for sparse index falsybool, only do 'is not null' and throw if false
  - [ ] uuidColumn() -> use buffer stringify/parse to implement efficient UUID by default. See https://stackoverflow.com/questions/20342058/which-uuid-version-to-use
- [ ] foreign key support
- [ ] prepared statements for .search
  - `q = m.prepareSearch(args, options); q.search(args, options) // not allowed to change arg items, where or sort`
  - However, `whereVal` values should be allowed to change
  - But `where` should stay the same and should not be recalculated, so best if it is not a function. Most of the time this can be done.
  - Probably `.makeSelect()` would need to return an intermediate query object
  - Note: When using prepared statements, replace `IN (?,?,?)` clauses with `IN (SELECT value FROM json_each(?))` and pass the array as a JSON string. That way the prepared statement can handle any array length
- Benchmark test that warns if runtime increases on current system
  - getting/setting can be optimized by creating Functions instead of lodash get/set, but first create benchmark
  - it's probably better to always create same object from columns and then assign json if not null
- Test for `uniqueSlugId`
- Booleans should be stored as 0/1 if real, except when sparse indexing, then NULL/1. If not real, the index and where clause should be `IFNULL(json..., false)`

## Queue

### Important

- [ ] allow marking an event as being processed, by setting worker id `where workerId is null` or something similar
- [ ] workers should register in a table and write timestamps for a watchdog
- [ ] while an event is being worked, next event can't be worked on.
- [ ] it may be better to `INSERT IF NOT EXISTS` a knownV event instead of using the sequence table?

### Nice to have

- [ ] split history into multiple files, per 1GB, automatically attach for queries. (make sure it's multi-process safe - lock the db, make sure new writes are not possible in old files)
- [ ] test multi-process changes

## ESModel

### Nice to have

- [ ] .get for the RO ESModel uses .getCached, with a caching-map limiting the amount, cleared when the version changes
- [ ] .changeId (`mv:[[oldId, newId],…]` apply action?)

## ESDB

### Important

- [ ] split queue in history (append-only) and results. The results are only for debugging and include one row per subevent and a diff vs the original data after preprocessing.
  - Ideally, the results go in a different db that can be split at will.
  - for multi-process, lock the result db exclusively to worker
  - re-processing events clears all subevent rows
- [ ] Add `beforeApply` phase which runs after all reducers ran so it has access to the state of the DB before the changes are applied.

### Nice to have

- [ ] make results table optional
- [ ] add eventSpy, e.g. `eSDB.debug(boolean|{filter()})`
- [ ] in non-prod, randomly run preprocessor twice (keep event in memory and restart handling) to verify repeatability
- [ ] don't store empty result sub-events
- [ ] `reducerByType` object keyed by type that gets the same arguments as preprocessor
  - same for preprocessor/deriver/transact
- [ ] explore read-only clones that get the event queue changes only, dispatches go to primary db. Will need Raft implementation.
