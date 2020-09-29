# Server Side Redux

## Concept

Run a Redux-like cycle on the server side to transform incoming events into database writes.

Basic ideas from [Turning The Database Inside Out](https://www.confluent.io/blog/turning-the-database-inside-out-with-apache-samza/) talk.

## Parts

- **Version**: All changes have a version `v`, a non-zero monotonously increasing positive integer.
- **Event**: An object with `v` (assigned by the queue), `type` and arbitrary `data` to describe a past event or desired change to server state.
  - Examples: "this `user` logged in", "this `user` requested changing this `document`", "this `weatherData` arrived", "this `amount` needs to be refunded", …
- **Event queue**: A FIFO store, holding events until they are processed.
  - This should be a very reliable store.
  - When an `event` is put on the queue, it gets a unique incremented `v`.
  - Events can lead to sub-events, which are processed as part of the transaction of the event
- **State**: The state consists of sets of objects with at-least-per-set-unique-ids.
  - Database tables can store a row per set entry, so that's what we'll do. Each set is a table. We also store the current version in a separate one-row table (so that concurrent transactions conflict). The database is presumed to always be consistent (all tables and version in sync).
- **Middleware => Preprocessors**: Redux middleware is mostly implemented as preprocessor functions that run within the event handling transaction, and can alter the event based on data from all tables. Preprocessors should only be used to convert events into a canonical representation. Side-effects like I/O should be performed by restartable workers that store their state in the DB ("this needs doing", "this was done", "this failed, retry x more times", …).
- **Reducers**: Reducers are pure functions that get current state and the event, and return a description of what should happen to the state to get to the next version.
  - Current state (the DB model) is accessed by calling (asynchronous) DB functions
  - Each reducer is responsible for a single set (table)
    - Contrary to Redux, in ESDB reducers also get access to the state of other reducers, this turns out to be very useful
  - Given the same state and event, the reducer always returns the same result
  - The result is an object `{error: {message: "..."}, set: [{id, ...}], rm: [id, ...], events: [], audit, ...}`
    - `error`: Present if the event can not be processed for some reason, contains information to debug the problem. This halts all event processing until the problem is fixed. To represent e.g. denial of requests, use a different key (ESModel uses `esFail`) and inspect the event result to see if it the request was granted.
    - `events`: any sub-events that should be processed. They are handled in-order after applying the changes of the parent event.
    - Several keys are used by the JsonModel `applyResult`:
      - `set`: objects to replace in the table
      - `ins`: objects to insert in the table (errors if exist)
      - `upd`: objects to shallow-update
      - `sav`: objects to shallow-update or insert if missing
      - `rm`: ids of objects to remove from the table
      - by subclassing, the behavior can be tweaked
    - any other keys: opaque data describing the change, can be informational or used by a custom `applyResult`
  - **Derivers**: Functions that calculate "secondary state" from the changes. They can serve to make the event result smaller
- **History**: An ordered list of reduced events (so `{v, type, data, result}`). This is not required, and the event can be abridged. It could serve as an audit log. If all the original event data is retained, it can be used to reprocess the database from scratch.
- **Sub-events**: To make the event processing code simpler, ESDB allows adding derived events from anywhere in the redux cycle. These events are processed depth-first. For example, a USER_LOGIN event can result in a USER_REGISTERED event if they logged in via OAuth for the first time.

## Flow

- Inbox cycle:

  - An event comes in. Think of events as newspaper headlines, they describe something that happened. They are not commands, they are facts and requests.
    - Any event that needs external information to process should be split up into multiple asynchronous events that have all the necessary data.
  - **Dispatch**: The event is stored on the queue and auto-assigned a version `v`

- Redux cycle:
  - **Wait for event**:
    - Based on the DB processed version, get the next event from the queue.
  - **Start Transaction**:
    - All the below now runs in a transaction in a separate read-write DB connection.
    - The separate connection makes sure that other code only sees the previous version via the default read-only connection
    - If any step fails, the transaction is rolled back and retried later.
    - All later events are held until the error is resolved, possibly through manual resolution (by fixing the code, the event data or disabling/removing the event).
    - As such, avoid errors at all times, instead recording failure states.
  - **Preprocess**:
    - `preprocess`ors can change the event object before it's passed to the reducers.
    - Mutation is allowed, but this is stored in the DB, so make sure it's repeatable.
    - Version cannot change, but e.g. id could be assigned.
    - For example, ESModel uses this to make sure the data always includes the object id even for new objects.
    - Failing preprocessors abort the transaction
  - **Reduce**:
    - The event is passed to all `reducer`s
    - All reducers see the same state, the DB after processing the previous event
    - Reducers produce a change description and sub-events
    - Event object becomes history object with `result` attribute
    - Failing reducers abort the transaction
  - **Apply**
    - All results are written, including history object
    - The way they are written is arbitrary, implemented by an `applyResult` method
    - Failing applyResult functions abort the transaction
  - **Derive**
    - `deriver`s are called with the history object
    - They change their models as they see fit
    - Failing derivers abort the transaction
  - **SubEvents**
    - Each added subevent undergoes these same steps in the same transaction, with the same version number.
  - **Transact**
    - All `transact` callbacks are called sequentially in undefined order
    - They receive a `dispatch` function that behaves like the `ESDB.dispatch` method but adds and waits for subevents
    - This allows working with ESModel in a single transaction and still having an event log
  - **End transaction**
    - The DB is now at the event version.
  - **Listeners**:
    - They get called with the history object after the Redux cycle completes.
    - Note that side-effect workers should wait until the queue is processed (`eSDB.waitForQueue()`), making sure they are not working from stale data

The Inbox flow can happen at any time; the Reduce/Write cycle happens sequentially.

If an incoming request is for some side-effect change, this should be stored as a sequence of events, recording the intent, the intermediate states and the end result. The database is then used by worker functions to know the current state of side-effects. These workers should be restartable and correctly manage real-world state.

## Advantages

All the advantages of Redux, but applied to the server:

- time travel (requires snapshots or reversible events (storing the full calculated change with the event))
- clean code, easy to unit test
- reprocessing: just start from 0
- reducers can run in parallel on the same event, interleaving I/O requests
- easy to generate audit log

## Limitations

### Risks

- Data loss can occur in all the normal ways, but the event log in essence duplicates the data
- The hard-line approach of failing events halting event processing can result in servers needing immediate care, but it is really the only sane way to handle data, and the event handling code should be robust

### Model

It is sometimes harder to model all changes as events, for example spawning side effects and keeping track of their state.

### Resource use

- Requires a data store with transactions, so that the new state and history is stored in one go.
- Not well suited for high-volume writes due to per-event "synchronous" updating. Caching can help.
- Not well suited for change sets exceeding available working memory. (e.g. delete all records). Those have to be special-cased within the `applyEvent` code.
- Not well suited for huge events since events are loaded into memory during processing and written several times (e.g. >2MB of data in the event). Move big data out of the event and use side-effects.
- Single master for event queue. Sharding might help if that's a problem.

## Implementation

Up until v3 this was implemented by redux with changes for asynchronous behavior, but in v3 the concepts were implemented directly to allow for sub-events.

### GraphQL mutations

Mutations assume that they can return either with an Error or the result value of the mutation. This means keeping track of the event execution as it passes through all the layers. To that end, `dispatch` tracks event completion even if it happened in another process.

## DevOps Scenarios

### Start from existing database

- Add history and version table, mark all tables as a first version
- Add new reducers, see below

### Add new table/reducer

- Add reducer to reducers
- Either:
  - Calculate/provide table at current db version in a migration
  - Start empty, run all stored events

### Change reducer

- Change reducer in reducers
- Either:
  - Convert table in a migration
  - Start empty, run all stored events

### Running out of disk

- Prune history
  - Remove old entries, perhaps keeping the last X, as well as important ones
  - Remove metadata of old entries, perhaps only keeping the audit information
- Upgrade the server

### Running out of CPU

- Shard DB: create more writers
  - Copy the DB to multiple masters
  - Replace the reducers with sharding versions
  - Update tables in a migration, pruning data not belonging to the shard
- Duplicate servers: create more readers
  - Copy the DB etc to multiple readers
  - Synchronize events so there is absolute ordering and no previous version insertions after a version was stored in the DB
- Upgrade the server
