# Server Side Redux

## Concept

Run a Redux-like cycle on the server side to transform incoming events into database writes.

Basic ideas from [Turning The Database Inside Out](https://www.confluent.io/blog/turning-the-database-inside-out-with-apache-samza/) talk.

## Parts

* **Version**: All changes have a `version`, an arbitrary monotonously increasing sortable value.
* **Event**: An object with `version` (assigned by the queue), `type` and arbitrary `data` to describe a desired change to server state.
  * Examples: "this `user` logged in", "this `user` requested changing this `document`", "this `weatherData` arrived", …
* **Middleware**: Not sure if needed yet, can be used to arbitrarily convert incoming events before they are queued events
* **Event queue**: A FIFO store, holding events until they are processed.
  * This should be a very reliable store.
  * When an `event` is put on the queue, it gets a unique incremented `version`.
* **State**: The state consists of sets of objects with at-least-per-set-unique-ids.
  * Database tables can store a row per set entry, so that's what we'll do. Each set is a table. We also store the current version in a separate one-row table (so that concurrent transactions conflict). The database is presumed to always be consistent (all tables and version in sync).
* **Reducers**: Reducers are pure functions that get current state and the event, and return a description of what should happen to the state to get to the next version.
  * Current state is accessed by calling (asynchronous) functions
  * Each reducer is responsible for a single set (table) and can't read other sets
  * Given the same state and event, the reducer always returns the same result
  * The result is an object `{error: {message: "..."}, changed: [{id, ...}], deleted: [id, ...], audit, ...}`
    * `error`: Present if the event can not be processed. The event will be marked as failed in the history and all changes proposed by the other reducers will be ignored
    * `changed`: objects to write in the set
    * `deleted`: ids of objects to remove from the set
    * `audit`: opaque data describing the change
    * There can be extra information for the writer process, like a description of some special change
  * After all reducers ran, all the changes/deletions, the history entry and the version change are written as a single transaction
* **History**: An ordered list of reduced events (so `{version, type, data, result}`). This is not required, and the event can be abridged. It could serve as an audit log. If all the original event data is retained, it can be used to reprocess the database from scratch.

## Flow

* Inbox cycle:
  * An event comes in. Think of events as newspaper headlines, they describe something that happened. They are not commands, they are facts and requests.
  * The event passes through middleware, which can transform it, drop it, and/or send new events
  * **Dispatch**: The event is stored on the queue and assigned a `version`

* Redux cycle:
  * **Wait for event**: get the v+1 event from the queue
  * **Preprocess**: `preprocess`ors can change the event object before it's passed to the reducers. They should return the new event object if they change it. Version cannot change, but e.g. id could be assigned.
  * **Reduce**:
    * The event is passed to all `reducer`s, as well as a model object that allows querying the current state in each reducer's own set
    * Reducers produce a change description
    * Event object becomes history object with `result` attribute
  * **Apply**
    * Starts transaction
    * All results are written, including history object
    * The way they are written is arbitrary, as long as the reducers have a way to get at the current state. There could be reducers that write to memory.
    * Failing to apply aborts the transaction
  * **Derive**
    * `deriver`s are called with the history object
    * They change their models as they see fit
    * Failing derivers abort the transaction
    * Ends transaction. The DB is now at the event version.

  * Listeners: They can get called with the history object after the Redux cycle completes

The Inbox flow can happen at any time; the Reduce/Write cycle happens sequentially.

If an incoming event is a request for some side-effect change, this should fire off the change in the middleware, which adds metadata to the request event. Once the side-effect has been performed, this can be sent as another event. If desired, in-flight side-effects can be kept track of in the database that way, and restarted or cancelled if needed. Another option is performing side-effects in the listeners.

## Advantages

All the advantages of Redux, but applied to the server:

* time travel (requires snapshots or reversible events (storing the full calculated change with the event))
* clean code, easy to unit test
* reprocessing: just start from 0
* reducers can run in parallel (not super useful with node due to communication overhead between processes)
* easy to generate audit log

## Limitations

### Risks

Data loss can occur in all the normal ways, but also if:

* the request is accepted on the server before it is saved on the queue (esp. with async middleware).
  * Mitigate this by storing incomplete events on the queue while they are being processed, so this situation can be detected and perhaps resolved on application startup
* Others? Not sure, for the rest data is written to the new location before it is removed from the old location, I think.

### Model

It is sometimes harder to model all changes as events, for example spawning side effects and keeping track of their state.

### Resource use

* Requires a data store with transactions, so that the new state and history is stored in one go.
* Not well suited for high-volume writes due to per-event "synchronous" updating. Caching can help. Reducers can run in parallel though.
* Not well suited for change sets exceeding available working memory. (e.g. delete all records). Those have to be special-cased with sql changes.
* Not well suited for huge events (e.g. >2MB of data in the event). Move data out of the event into files etc.
* Single master for event queue. Sharding might help if that's a problem.

## Implementation

### Code

1. Copy redux
1. Adapt to allow state being a query object and return value change description
1. Implement reliable queue, Inbox flow
1. Implement Reduce/Write worker
1. Implement trigger system
1. Profit!

* It is probably useful to co-locate reducers with the table model
* Likewise, "actions" that are called by mutations? Middleware?

### DB

* Tables should allow e.g. using RTree indexes, should be doable with JsonModel

### Queue

* Queue should be reliable, quick to distribute etc.
  * For sqlite, it would be better to store it in a separate DB file so Inbox writes are not blocked by the Write step
* Queue can be stored as part of the history table; the db version indicates the head of the queue
  * On sqlite this means that if the db is being written, it can't write new requests.

### GraphQL mutations

Mutations assume that they can return either with an Error or the result value of the mutation. This means keeping track of the event execution as it passes through all the layers.

This means that the mutation needs to add callback metadata to the event, and middleware/reducers should make sure that eventually a history event with the proper callback metadata is written, so that the Trigger step can notify the mutation handler.

## DevOps Scenarios

### Start from existing database

* Add history and version table, mark all tables as a first version
* Add new reducers, see below

### Add new table/reducer

* Add reducer to reducers
* Either:
  * Calculate/provide table at current db version in a migration
  * Start empty, run all stored events

### Change reducer

* Change reducer in reducers
* Either:
  * Convert table in a migration
  * Start empty, run all stored events

### Running out of disk

* Prune history
  * Remove old entries, perhaps keeping the last X, as well as important ones
  * Remove metadata of old entries, perhaps only keeping the audit information
* Upgrade the server

### Running out of CPU

* Shard DB: create more writers
  * Copy the DB to multiple masters
  * Replace the reducers with sharding versions
  * Update tables in a migration, pruning data not belonging to the shard
* Duplicate servers: create more readers
  * Copy the DB etc to multiple readers
  * Synchronize events so there is absolute ordering and no previous version insertions after a version was stored in the DB
* Upgrade the server
