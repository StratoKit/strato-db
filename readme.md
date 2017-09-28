# strato-db [![Build Status](https://travis-ci.org/Yaska/strato-db.svg?branch=master)](https://travis-ci.org/Yaska/strato-db)

> NoSQL-hybrid with Event Sourcing based on sqlite

The overall concept is to be a minimal wrapper that keeps SQL close by, but allows schemaless storage for where you want it.

`DB`: Wraps a Sqlite3 database with a lazy-init promise interface; has easy migrations

`JsonModel`: Stores given objects in a `DB` instance as JSON fields with an `id` column, other columns can be calculated or be virtual. You can only perform searches via the wrapper on defined columns.

`EventQueue`: Stores events in an auto-incrementing `DB` table. Minimal message queue.

`EventSourcingDB`: Implements the Event Sourcing concept in a DB via an asynchronous fork of `redux`. See [Server Side Redux](./Server Side Redux.md).

## Install

```js
$ npm install Yaska/strato-db#master-build
...
```

## Usage

```js
import config from 'stratokit/config'
import {DB, EventQueue, EventSourcingDB, JsonModel} from 'strato-db'

const {main: {file}, queue: {file: qFile}, debug: verbose} = config.db

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
        info: {jsonPath: 'info', index: true},
      },
    })
  }
}

db.addModel(Things)

const eSDB = new EventSourcingDB({db, queue, models: {dateRanges, derivedStuff}})

// only opens the db once this runs
await db.models.things.set({id: 'foo', info: 'is a foo'})
await db.models.things.search({info: 'is a foo'})
```

## API: TO DO

See the tests for hints in the mean time.

### stratoDb(input, [options])

#### input

Type: `string`

Lorem ipsum.

#### options

##### foo

Type: `boolean`<br>
Default: `false`

Lorem ipsum.


## License

MIT © [Wout Mertens](https://yaska.eu)
