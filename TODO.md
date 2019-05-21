# TODO list

## General

- [ ] Get started on documentation
- [ ] Try to clean up the API, make it consistent between classes. Ideas:
  - DB and ESDB to have same API surface (.addModel)
  - join JsonModel and ESModel code, switch behavior based on `dispatch` option
- [ ] optimize

## node-sqlite3

### Someday

- [ ] sync interface for e.g. pragma data_version and BEGIN IMMEDIATE. Already did some work on it but it segfaults

## DB

### Nice to have

- [ ] PRAGMA schema.synchronous = extra (make configurable)
- [ ] pragma journal_size_limit setting, default to 4MB (1000 pages)
- [ ] in development, invert PRAGMA reverse_unordered_selects every so often
  - this makes sure that ordering issues are noticed
- [ ] accept column def and create/add if needed, using pragma table_info

  ```text
  > pragma table_info("_migrations");
  cid|name|type|notnull|dflt_value|pk
  0|runKey|STRING|0||0
  1|ts|DATETIME|0||0
  2|up|BOOLEAN|0||0
  ```

- [ ] manage indexes, using PRAGMA index_list. Drop unused indexes with \_strato prefix
- withTransaction
  - [ ] re-run fn() if commit fails (what are transient failure codes?)
    - [ ] test with multi connections
    - [ ] test with multi process
- maintenance
  - [ ] run PRAGMA quick_check at startup
  - [ ] run pragma optimize every few hours
  - [ ] setting for running vacuum when idle (auto_vacuum?)
  - [ ] setting for incremental_vacuum, running with N=100 after each transaction
  - [ ] figure out if vacuum, pragma optimize and integrity_check can run while other processes are writing, if so run them in a separate connection
- [ ] put all metadata in `_stratoMeta` table
- [ ] prepared statements
  - similar to makeSelect, but cannot change sort etc.
  - `where` values can change, just not the amount of items in arrays
  - calling them ensures serial access because of binding
  - => prepare, allow .get/all/etc; while those are active calls are queued up
    https://github.com/mapbox/node-sqlite3/wiki/API#statementbindparam--callback
  - [ ] what happens with them on schema change?
  - When using prepared statements, replace `IN (?,?,?)` tests with `IN (select value from json_each(?))` and pass the array as a JSON string. That way the prepared statement can handle any array length
- [ ] if migration is `{undo:fn}` it will run the `undo` only if the migration ran before. We never needed `down` migrations so far.

### Someday

- [ ] with sqlite 3.22, use the btree info extension to provide index sizes at startup if debug enabled
- When async iterators are here, make one for db.each

## JsonModel

### Important

- [ ] unique indexes should fail when inserting non-unique, not overwrite other. ID takes precedence.

  ```sql
  CREATE TABLE demo(id INTEGER PRIMARY KEY, k TEXT, otherstuff ANY);
  CREATE INDEX demo_k ON demo(k);
  CREATE TRIGGER demo_trigger1 BEFORE INSERT ON demo BEGIN
    SELECT raise(ABORT,'uniqueness constraint failed on k')
      FROM demo WHERE k=new.k;
  END;
  ```

- [ ] columns using the same path should get the same JSON path. There are some edge cases.

### Nice to have

- [ ] validate(value): must return truthy given the current value (from path or value()) or storing throws
- [ ] also do stringify on paths, e.g. to stringify objects
- [ ] column.version: defaults to 1. When version increases, all rows are rewritten
  - do not change extra columns, that is what migrations are for
- [ ] recreate index if expression changes
- [ ] indexes: `[{expression, where}]` extra indexes
  - [ ] auto-delete other indexes, API change
- [x] if column value is function, call with `({columnName})` => helpers
  - [ ] objectColumn() helper -> type=JSON, NULL === {}, stringify checks if object (char 0 is `{`)
  - [ ] boolColumn() -> `type="INTEGER"; parse = Boolean; stringify=Boolean`
  - [ ] falsyColumn() -> implement falsyBool
  - [ ] uuidColumn() -> use buffer stringify/parse to implement efficient UUID by default. See https://stackoverflow.com/questions/20342058/which-uuid-version-to-use
- [ ] foreign key support
- [ ] prepared statements
  - `q = m.prepare(args, options); q.search(args, options) // not allowed to change arg items, where or sort`
  - However, `whereVal` values should be allowed to change
  - But `where` should stay the same and should not be recalculated, best if it is not a function. Most of the time this can be done
  - Probably `.makeSelect()` would need to return an intermediate query object
- Benchmark test that warns if runtime increases on current system
  - getting/setting can be optimized by creating Functions instead of lodash get/set, but first create benchmark
  - it's probably better to always create same object from columns and then assign json if not null
- Test for `uniqueSlugId`

## Queue

### Important

- [ ] allow marking an event as being processed, by setting worker id `where workerId is null` or something similar
- [ ] workers should register in a table and write timestamps for a watchdog
- [ ] while an event is being worked, next event can't be worked on.

### Nice to have

- [ ] cancellable getNext Promise
- [ ] test multi-process changes

## ESDB

### Nice to have

- [ ] `reducers` object keyed by type that gets the same arguments as preprocessor
- [ ] .get for the RO ESModel uses .getCached, with a caching-map limiting the amount, cleared when the version changes
- [ ] .changeId for ESModel (`mv:[[oldId, newId],…]` apply action?)
- [ ] split up into more files, move tests
