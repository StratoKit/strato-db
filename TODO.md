# TODO list

## node-sqlite3

* [ ] request sync interface for e.g. pragma data_version and BEGIN IMMEDIATE

## DB

* [ ] mark migrations in progress for multi-process starting at the same time
* [ ] pragma recursive_triggers
* [ ] PRAGMA schema.synchronous = extra (make configurable)
* [ ] pragma journal_size_limit setting, default to 4MB (1000 pages)
* [ ] withTransaction: document that
      _ this makes sure only the running function sees the intermediate state
      _ alternatively, document this and require 2 models, e.g. ESDB
  * JsonModel will need to honor this
* [ ] in development, invert PRAGMA reverse_unordered_selects every so often \* this makes sure that ordering issues are noticed
* [ ] accept column def and create/add if needed, using pragma table_info
* [ ] manage indexes, using PRAGMA index_list
* withTransaction
  * [ ] re-run fn() if commit fails (what are transient failure codes?)
        _ [ ] test with multi connections
        _ [ ] test with multi process
* maintenance
  * [ ] run PRAGMA quick_check at startup
  * [ ] run pragma optimize every few hours
  * [ ] setting for running vacuum when idle
  * [ ] setting for incremental_vacuum, running with N=100 after each transaction
  * [ ] figure out if vacuum, pragma optimize and integrity_check can run while other processes are writing, if so run them in a separate connection
* [ ] report: `.dump` should include user_version
* [ ] put all metadata in `_stratoMeta` table, including queue version etc
* [ ] prepared statements
  * similar to makeSelect, but cannot change sort etc.
  * `where` values can change, just not the amount of items in arrays
  * calling them ensures serial access because of binding
  * => prepare, allow .get/all/etc; while those are active calls are queued up
    https://github.com/mapbox/node-sqlite3/wiki/API#statementbindparam--callback
  * [ ] what happens with them on schema change?
* [ ] with sqlite 3.22, use the btree info extension to provide index sizes at startup if debug enabled
* [ ] allow migrations to be functions (so no `up`); if migration is `{undo:fn}` it will run the `undo` only if the migration ran before. We never needed `down` migrations so far.

## JsonModel

* [ ] unique indexes should fail when inserting non-unique, not overwrite other. ID takes precedence. See TRIGGER comment
* [ ] move function implementations to separate files, especially constructor and makeSelect; initialize all this.x helper vars so they are obvious
* [ ] column defs are migrations and recalculate all records if the version changes
* [ ] allow `get` on `jsonPath` once we have versioned columns
  * Support subpaths
  * This allows being a little more schema-full
* [ ] when setting an object without Id, use INSERT so calculated Id has to be unique and can't silently overwrite
* [ ] foreign key support
* [ ] `required` bool/validation function for object/column? Or leave that to `set`?
* [ ] mark any column as `extract`; auto-migrate, auto-change-indexes
* [ ] allow `value()` on non-extract columns
* [ ] `ifMissing` bool for `value()`

## Queue

* [ ] cancellable getNext Promise
* [ ] don't time out, use pragma data_version to poll DB
* [ ] test multi-process changes

## ESDB

* [ ] promises for each deriver so they can depend on each other
  * to be specified at startup, and checked for cycles
* [ ] change .store to use .db.models
* [ ] test for multi-process - especially store listeners should get (all missed?) events
* [ ] think about transient event errors vs event errors vs db errors - if transient, event should be retried, no?
* [ ] jsonmodel for ESDB that includes auto-caching between events, use pragma data_version to know when data changed, applyChanges
* [ ] this might race, applyer should also resolve earlier promises
  * maybe have a single promise for next event resolved and fetch from history if your event was earlier
* [ ] factor out applying for reuse between redux error and apply
* [ ] setting for query_only pragma between writes?
  * only when you don't make any changes to the db between events
  * counter-example: metadata for tracking sync status
* [ ] IDEA eventually allow multiple ESDBs by storing version per queue name
