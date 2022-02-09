# Strato-DB

> MaybeSQL with Event Sourcing based on SQLite

The overall concept is to be a minimal wrapper that keeps SQL close by, but allows schemaless storage for where you want it.

## Install

```shell
npm install strato-db
```

## Usage

Simple CRUD DB:

```js
import {DB, JsonModel} from 'strato-db'

const db = new DB({file: 'data/mydb.sqlite3', verbose: true})

class Things extends JsonModel {
	constructor(options) {
		super({
			...options,
			name: 'things',
			columns: {
				id: {type: 'INTEGER'},
				count: {type: 'INTEGER', index: 'SPARSE'},
			},
		})
	}
}

db.addModel(Things)

// db only opens the file once this runs
await db.store.things.set({id: 5, name: 'hi', count: 3})
// Get all items that have count 3
console.log(await db.store.things.search({count: 3}))
```

DB with Event Sourcing:

```js
import {DB, EventQueue, EventSourcingDB, ESModel} from 'strato-db'

const qDb = qFile && qFile !== file ? new DB({file: qFile, verbose}) : db
qDb.addModel(EventQueue, {name: 'queue'})
const queue = qDB.store.queue

class ESThings extends ESModel {
	constructor(options) {
		super({
			...options,
			name: 'things',
			columns: {
				id: {type: 'INTEGER'},
				count: {type: 'INTEGER', index: 'SPARSE'},
			},
		})
	}
}

const eSDB = new EventSourcingDB({
	db,
	queue,
	models: {things: {Model: ESThings}},
})

await eSDB.store.things.set({id: 5, name: 'hi', count: 3})
console.log(await eSDB.store.things.search({count: 3}))
// See the created events
console.log(await eSDB.queue.all())
```

## API

The API is class-based. There are types in JSDoc and in types.d.ts, which are the only documentation for now.

The design of EventSourcingDB is discussed in [Server Side Redux](./Server Side Redux.md)

Classes:

- `SQLite`: Wraps a Sqlite3 database with a lazy-init promise interface
- `DB`: Adds models and migrations to SQLite3
- `JsonModel`: Stores given objects in a `DB` instance as JSON fields with an `id` column, other columns can be calculated or be virtual. You can perform searches via the wrapper on defined columns.
- `EventQueue`: Stores events. Minimal message queue.
- `EventSourcingDB`: Implements the Event Sourcing concept using EventQueue. See [Server Side Redux](./Server Side Redux.md).
- `ESModel`: A drop-in replacement for JsonModel to use EventSourcingDB. Modifications are dispatched as events and awaited

With the TypeScript definitions you can provide a Type for the stored objects and the config each model uses. This allows typechecking CRUD inputs and results, even in plain JS (with JSDoc comments).

## Status

This project is used in production environments.

Since it wraps SQLite, the actual storage of data is rock-solid.

It works fine with multi-GB databases, and if you choose your queries and indexes well, you can have <1ms query times.

The important things are tested, our goal is 100% coverage.

Multi-process behavior is not very worked out for the `EventSourcingDB`:

- Since it's layering a single-locking queue on top of SQLite, it works without problems, but no effort is made yet to avoid double work. It would require workers "locking" events and watching each other's timestamps.
- To have DB slaves, the idea would be to either use distributed SQLite as implemented by BedrockDB, or to distribute the event queue to slaves and have them derive their own copy of the data.

Take a look at [the planned improvements](./TODO.md).

## License

MIT © [Wout Mertens](https://stratokit.io)
