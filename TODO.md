# TODO list

## General

- [ ] Make safe for use in multi-process writers (ESDB)
- [ ] Get started on documentation
- [ ] Try to clean up the API, make it consistent between classes. Ideas:
  - DB and ESDB to have same API surface (.addModel)
  - join JsonModel and ESModel code, switch behavior based on `dispatch` option
  - db.models => db.store or eSDB.store => eSDB.models
- [ ] optimize

## node-sqlite3

### Someday

- [ ] sync interface for e.g. pragma data_version and BEGIN IMMEDIATE. Already did some work on it but it segfaults

## DB

### Nice to have

- [ ] remove waitForP again - onWillOpen can simply return that promise if needed
- [ ] pragma recursive_triggers
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
- [ ] put all metadata in `_stratoMeta` table, including queue version etc
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

### Nice to have

- [ ] create non-integer primary keys with NOT NULL (sqlite bug)
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
- [ ] move function implementations to separate files, especially constructor and makeSelect; initialize all this.x helper vars so they are obvious
- [ ] foreign key support
- [ ] prepared statements
  - `q = m.prepare(args, options); q.search(args, options) // not allowed to change arg items, where or sort`
  - However, `where` parameter values should be allowed to change
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
- [ ] probably should write more tests for getNext with nextAddedP

## ESDB

### Important

- Somehow unhandledRejection can happen in preprocessor `{ v: 119531, type: 'CONTRACT_CONFIRMED', ts: 1538636160023, data: { id: 'contracts-34706' }, capId: 29682, error: { contracts: 'Error: No "id" given for "clients"\n at Clients_Clients.get (/Users/wmertens/Documents/AeroFS/Projects/meatier/node_modules/strato-db/src/JsonModel.js:834:5)\n at Object.get [as preprocessor] (/Users/wmertens/Documents/AeroFS/Projects/meatier/build/server/webpack:/src/_server/database/contracts/contractConfirmed.js:82:37)\n at <anonymous>' } }`
- !!! Multi-process handling:
  - [ ] When handling event, check that the DB is on `event.v - 1`, else try again
    - This means we can never skip a version…
  - [ ] Store listeners should also get events handled by other processes
  - [ ] ESModel getNextId should only work during reducer run and be reset before

### Nice to have

- [ ] .get for the RO ESModel uses .getCached, with a caching-map limiting the amount, cleared when the version changes
- [ ] .changeId for ESModel (`mv:[[oldId, newId],…]` apply action?)
- [ ] think about transient event errors vs event errors vs db errors - if transient, event should be retried, no? Maybe configuration on what to do with errors.
  - When an apply failed due to non-transient error, should the application halt or ignore?
- [ ] finish stopPolling implementation
- [ ] Allow passing a Model directly? Maybe only allow that?
- [ ] promises for each deriver so they can depend on each other
  - to be specified at startup, and checked for cycles
- [ ] jsonmodel for ESDB that includes auto-caching between events, use pragma data_version to know when data changed, applyChanges
- [ ] IDEA eventually allow multiple ESDBs by storing version per queue name
- [ ] optimization: if multiple events in queue, do per 10 in the same transaction
