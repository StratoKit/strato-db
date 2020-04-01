**Note**: The most recent developments are in the https://github.com/StratoKit/strato-db/tree/improvements branch

# Strato-DB

> NoSQL-hybrid with Event Sourcing based on SQLite

The overall concept is to be a minimal wrapper that keeps SQL close by, but allows schemaless storage for where you want it.

`DB`: Wraps a Sqlite3 database with a lazy-init promise interface; has easy migrations

`JsonModel`: Stores given objects in a `DB` instance as JSON fields with an `id` column, other columns can be calculated or be virtual. You can only perform searches via the wrapper on defined columns.

`EventQueue`: Stores events in an auto-incrementing `DB` table. Minimal message queue.

`EventSourcingDB`: Implements the Event Sourcing concept using EventQueue. See [Server Side Redux](./Server Side Redux.md).

`ESModel`: A drop-in replacement for JsonModel to use ESDB

## Install

```js
$ npm install @yaska-eu/strato-db
...
```

## Usage

```js
import config from 'stratokit/config'
import {DB, EventQueue, EventSourcingDB, JsonModel} from 'strato-db'

const {
	main: {file},
	queue: {file: qFile},
	debug: verbose,
} = config.db

const db = new DB({file, verbose})
const qDb = qFile && qFile !== file ? new DB({file: qFile, verbose}) : db

export const queue = new EventQueue({db: qDb})

class Things extends JsonModel {
	constructor(options) {
		super({
			...options,
			name: 'things',
			columns: {
				...options.columns,
				info: {index: 'SPARSE'},
			},
		})
	}
}

db.addModel(Things)

const eSDB = new EventSourcingDB({
	db,
	queue,
	models: {dateRanges, derivedStuff},
})

// only opens the db once this runs
await db.store.things.set({id: 'foo', info: 'is a foo'})
await db.store.things.search({info: 'is a foo'})
```

## API

The API is class-based. [You can read it here](./API.md).

The design of EventSourcingDB is discussed in [Server Side Redux](./Server Side Redux.md)

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

MIT © [Wout Mertens](https://yaska.eu)
