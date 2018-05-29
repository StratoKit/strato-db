# TODO list

## General

* [ ] Make safe for use in multi-process writers (migrations, ESDB)
* [ ] Get started on documentation
* [ ] Release as open source
* [ ] Try to clean up the API, make it consistent between classes. Ideas:
  * db.models => db.store or eSDB.store => eSDB.models
  * column.jsonPath => column.path
  * columns are shortcuts for attribute searches, `set()` enforced values, where clauses, actual columns, indexes etc. Not very pretty right now.
  * add column type `VIRTUAL`

## node-sqlite3

### Someday

* [ ] sync interface for e.g. pragma data_version and BEGIN IMMEDIATE. Already did some work on it but it segfaults
* [ ] make repro for segfault on close when running tests

## DB

### Nice to have

* [ ] remove waitForP again - onWillOpen can simply return that promise if needed
* [ ] pragma recursive_triggers
* [ ] PRAGMA schema.synchronous = extra (make configurable)
* [ ] pragma journal_size_limit setting, default to 4MB (1000 pages)
* [ ] in development, invert PRAGMA reverse_unordered_selects every so often
  * this makes sure that ordering issues are noticed
* [ ] accept column def and create/add if needed, using pragma table_info
  ```
  > pragma table_info("_migrations");
  cid|name|type|notnull|dflt_value|pk
  0|runKey|STRING|0||0
  1|ts|DATETIME|0||0
  2|up|BOOLEAN|0||0
  ```
* [ ] manage indexes, using PRAGMA index_list. Drop unused indexes with \_strato prefix
* withTransaction
  * [ ] re-run fn() if commit fails (what are transient failure codes?)
    * [ ] test with multi connections
    * [ ] test with multi process
* maintenance
  * [ ] run PRAGMA quick_check at startup
  * [ ] run pragma optimize every few hours
  * [ ] setting for running vacuum when idle (auto_vacuum?)
  * [ ] setting for incremental_vacuum, running with N=100 after each transaction
  * [ ] figure out if vacuum, pragma optimize and integrity_check can run while other processes are writing, if so run them in a separate connection
* [ ] put all metadata in `_stratoMeta` table, including queue version etc
* [ ] prepared statements
  * similar to makeSelect, but cannot change sort etc.
  * `where` values can change, just not the amount of items in arrays
  * calling them ensures serial access because of binding
  * => prepare, allow .get/all/etc; while those are active calls are queued up
    https://github.com/mapbox/node-sqlite3/wiki/API#statementbindparam--callback
  * [ ] what happens with them on schema change?
* [ ] if migration is `{undo:fn}` it will run the `undo` only if the migration ran before. We never needed `down` migrations so far.

### Someday

* [ ] with sqlite 3.22, use the btree info extension to provide index sizes at startup if debug enabled
* When async iterators are here, make one for db.each

## JsonModel

### Important

* [ ] unique indexes should fail when inserting non-unique, not overwrite other. ID takes precedence.
  ```
  CREATE TABLE demo(id INTEGER PRIMARY KEY, k TEXT, otherstuff ANY);
  CREATE INDEX demo_k ON demo(k);
  CREATE TRIGGER demo_trigger1 BEFORE INSERT ON demo BEGIN
    SELECT raise(ABORT,'uniqueness constraint failed on k')
      FROM demo WHERE k=new.k;
  END;
  ```

### Nice to have

* [ ] move function implementations to separate files, especially constructor and makeSelect; initialize all this.x helper vars so they are obvious
* [ ] column defs are migrations and recalculate all records if the version changes
* [ ] allow `get` on `jsonPath` once we have versioned columns
  * Support subpaths
  * This allows being a little more schema-full
* [ ] foreign key support
* [ ] `required` bool/validation function for object/column? Or leave that to `set`?
* [ ] mark any column as `extract`; auto-migrate, auto-change-indexes
* [ ] allow `value()` on non-extract columns
* [ ] `ifMissing` bool for `value()`, default `true`
* [ ] column type defaults to `'VIRTUAL'`
  * `get` should default to `true` on non-virtual columns
  * `jsonPath` would extract for non-virtual, and store as JSON if type JSON
* [ ] prepared statements
  * `q = m.prepare(args, options); q.search(args, options) // not allowed to change arg items, where or sort`
  * However, `where` parameter values should be allowed to change
  * Probably `.makeSelect()` would need to return an intermediate query object
* Benchmark test that warns if runtime increases on current system
* Test for `uniqueSlugId`

## Queue

### Nice to have

* [ ] Enforce known v on open instead of add
  * `model.onDbOpened`?
* [ ] cancellable getNext Promise
* [ ] use pragma data_version to poll DB in getNext
* [ ] test multi-process changes
* [ ] probably should write more tests for getNext with nextAddedP

## ESDB

#### Important

* !!! Multi-process handling:
  * [ ] When handling event, check that the DB is on `event.v - 1`, else try again
  * [ ] Store listeners should also get events handled by other processes

### Nice to have

* [ ] .changeId for ESModel (`mv:[[oldId, newId],…]` apply action?)
* [ ] think about transient event errors vs event errors vs db errors - if transient, event should be retried, no? Maybe configuration on what to do with errors.
  * When an apply failed due to non-transient error, should the application halt or ignore?
* [ ] finish stopPolling implementation
* [ ] Allow passing a Model directly? Maybe only allow that?
* [ ] promises for each deriver so they can depend on each other
  * to be specified at startup, and checked for cycles
* [ ] jsonmodel for ESDB that includes auto-caching between events, use pragma data_version to know when data changed, applyChanges
* [ ] reduce metadata in apply, so storing event errors on preprocess/reduce is simpler
* [ ] IDEA eventually allow multiple ESDBs by storing version per queue name
