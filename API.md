# API

## Classes

<dl>
<dt><a href="#EventQueue">EventQueue</a> ⇐ <code><a href="#JsonModel">JsonModel</a></code></dt>
<dd><p>An event queue, including history</p>
</dd>
<dt><a href="#DB">DB</a> ⇐ <code><a href="#SQLite">SQLite</a></code></dt>
<dd><p>DB adds model management and migrations to Wrapper.
The migration state is kept in the table &quot;&quot;{sdb} migrations&quot;&quot;.</p>
</dd>
<dt><a href="#SQLite">SQLite</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>SQLite is a wrapper around a single SQLite connection (via node-sqlite3).
It provides a Promise API, lazy opening, auto-cleaning prepared statements
and safe <code>db.run`select * from foo where bar=${bar}`</code> templating.</p>
</dd>
<dt><a href="#ESModel">ESModel</a> ⇐ <code><a href="#JsonModel">JsonModel</a></code></dt>
<dd><p>ESModel is a drop-in wrapper around JsonModel to turn changes into events.</p>
<p>Use it to convert your database to be event sourcing</p>
<p>Event data is encoded as an array: <code>[subtype, id, data, meta]</code>
Subtype is one of <code>ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)</code>.
<code>id</code> is filled in by the preprocessor at the time of the event.
<code>meta</code> is free-form data about the event. It is just stored in the history table.</p>
<p>For example: <code>model.set({foo: true})</code> would result in the event
<code>[1, 1, {foo: true}]</code></p>
</dd>
<dt><a href="#EventSourcingDB">EventSourcingDB</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>EventSourcingDB maintains a DB where all data is
atomically updated based on <a href="#Event">events (free-form messages)</a>.
This is very similar to how Redux works in React.</p>
</dd>
<dt><a href="#JsonModel">JsonModel</a></dt>
<dd><p>JsonModel is a simple document store. It stores its data in SQLite as a table, one row
per object (document). Each object must have a unique ID, normally at <code>obj.id</code>.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#sql">sql</a> ⇒ <code>array</code></dt>
<dd><p>sql provides templating for SQL.</p>
<p>Example:
  <code>db.all`select * from ${&#39;foo&#39;}ID where ${&#39;t&#39;}LIT = ${bar} AND json = ${obj}JSON`</code></p>
<p>is converted to
  <code>db.all(&#39;select * from &quot;foo&quot; where t = ? and json = ?&#39;, [bar, JSON.stringify(obj)])</code></p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#Event">Event</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#voidFn">voidFn</a> ⇒ <code>Promise.&lt;*&gt;</code> | <code>*</code></dt>
<dd></dd>
<dt><a href="#SearchOptions">SearchOptions</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#ColumnDef">ColumnDef</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#JMOptions">JMOptions</a> : <code>Object</code></dt>
<dd></dd>
</dl>

<a name="EventQueue"></a>

## EventQueue ⇐ [<code>JsonModel</code>](#JsonModel)
An event queue, including history

**Kind**: global class  
**Extends**: [<code>JsonModel</code>](#JsonModel)  

* [EventQueue](#EventQueue) ⇐ [<code>JsonModel</code>](#JsonModel)
    * [new EventQueue([name], [forever], [withViews])](#new_EventQueue_new)
    * [.parseRow](#JsonModel+parseRow) ⇒ <code>object</code>
    * [.set(event)](#EventQueue+set) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.getMaxV()](#EventQueue+getMaxV) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.add(type, [data], [ts])](#EventQueue+add) ⇒ [<code>Promise.&lt;Event&gt;</code>](#Event)
    * [.getNext([v], [noWait])](#EventQueue+getNext) ⇒ [<code>Promise.&lt;Event&gt;</code>](#Event)
    * [.cancelNext()](#EventQueue+cancelNext)
    * [.setKnownV(v)](#EventQueue+setKnownV)
    * [.makeSelect(options)](#JsonModel+makeSelect)
    * [.searchOne(attrs, options)](#JsonModel+searchOne) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.search(attrs, [options])](#JsonModel+search) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
    * [.searchAll(attrs, [options])](#JsonModel+searchAll) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
    * [.exists(attrs, [options])](#JsonModel+exists) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [.count(attrs, [options])](#JsonModel+count) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.numAggOp(op, colName, [attrs], [options])](#JsonModel+numAggOp) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.max(colName, [attrs], [options])](#JsonModel+max) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.min(colName, [attrs], [options])](#JsonModel+min) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.sum(colName, [attrs], [options])](#JsonModel+sum) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.avg(colName, [attrs], [options])](#JsonModel+avg) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.all()](#JsonModel+all) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
    * [.get(id, [colName])](#JsonModel+get) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.getAll(ids, [colName])](#JsonModel+getAll) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
    * [.getCached([cache], id, [colName])](#JsonModel+getCached) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.clearCache([cache], id, [colName])](#JsonModel+clearCache) ⇒ <code>DataLoader</code>
    * [.update(obj, [upsert], [noReturn])](#JsonModel+update) ⇒ <code>Promise.&lt;(object\|undefined)&gt;</code>

<a name="new_EventQueue_new"></a>

### new EventQueue([name], [forever], [withViews])
Creates a new EventQueue model, called by DB


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [name] | <code>string</code> | <code>&quot;&#x27;history&#x27;&quot;</code> | the table name |
| [forever] | <code>boolean</code> |  | should getNext poll forever? |
| [withViews] | <code>boolean</code> |  | add views to the database to assist with inspecting the data |
| [...rest] | <code>Object</code> |  | other params are passed to JsonModel |

<a name="JsonModel+parseRow"></a>

### eventQueue.parseRow ⇒ <code>object</code>
parses a row as returned by sqlite

**Kind**: instance property of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>parseRow</code>](#JsonModel+parseRow)  
**Returns**: <code>object</code> - - the resulting object (document)  

| Param | Type | Description |
| --- | --- | --- |
| row | <code>object</code> | result from sqlite |
| options | <code>object</code> | an object possibly containing the `cols` array with the desired column names |

<a name="EventQueue+set"></a>

### eventQueue.set(event) ⇒ <code>Promise.&lt;void&gt;</code>
Replace existing event data

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - Promise for set completion  

| Param | Type | Description |
| --- | --- | --- |
| event | [<code>Event</code>](#Event) | the new event |

<a name="EventQueue+getMaxV"></a>

### eventQueue.getMaxV() ⇒ <code>Promise.&lt;number&gt;</code>
Get the highest version stored in the queue

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the version  
<a name="EventQueue+add"></a>

### eventQueue.add(type, [data], [ts]) ⇒ [<code>Promise.&lt;Event&gt;</code>](#Event)
Atomically add an event to the queue

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Returns**: [<code>Promise.&lt;Event&gt;</code>](#Event) - - Promise for the added event  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| type | <code>string</code> |  | event type |
| [data] | <code>\*</code> |  | event data |
| [ts] | <code>Number</code> | <code>Date.now()</code> | event timestamp, ms since epoch |

<a name="EventQueue+getNext"></a>

### eventQueue.getNext([v], [noWait]) ⇒ [<code>Promise.&lt;Event&gt;</code>](#Event)
Get the next event after v (gaps are ok).
	 The wait can be cancelled by `.cancelNext()`.

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Returns**: [<code>Promise.&lt;Event&gt;</code>](#Event) - the event if found  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [v] | <code>number</code> | <code>0</code> | the version |
| [noWait] | <code>boolean</code> |  | do not wait for the next event |

<a name="EventQueue+cancelNext"></a>

### eventQueue.cancelNext()
Cancel any pending `.getNext()` calls

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
<a name="EventQueue+setKnownV"></a>

### eventQueue.setKnownV(v)
Set the latest known version.
New events will have higher versions.

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  

| Param | Type | Description |
| --- | --- | --- |
| v | <code>number</code> | the last known version |

<a name="JsonModel+makeSelect"></a>

### eventQueue.makeSelect(options)
Parses query options into query parts. Override this function to implement search behaviors.

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>makeSelect</code>](#JsonModel+makeSelect)  

| Param | Type | Description |
| --- | --- | --- |
| options | [<code>SearchOptions</code>](#SearchOptions) | the query options |

<a name="JsonModel+searchOne"></a>

### eventQueue.searchOne(attrs, options) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Search the first matching object

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>searchOne</code>](#JsonModel+searchOne)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the result or null if no match  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| options | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+search"></a>

### eventQueue.search(attrs, [options]) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
Search the all matching objects

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>search</code>](#JsonModel+search)  
**Returns**: <code>Promise.&lt;(object\|array)&gt;</code> - - `{items[], cursor}`. If no cursor, you got all the results. If `itemsOnly`, returns only the items array.  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |
| [options.itemsOnly] | <code>boolean</code> | return only the items array |

<a name="JsonModel+searchAll"></a>

### eventQueue.searchAll(attrs, [options]) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
A shortcut for setting `itemsOnly: true` on [search](search)

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>searchAll</code>](#JsonModel+searchAll)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the search results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+exists"></a>

### eventQueue.exists(attrs, [options]) ⇒ <code>Promise.&lt;boolean&gt;</code>
Check for existence of objects

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>exists</code>](#JsonModel+exists)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - - `true` if the search would have results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> \| <code>string</code> \| <code>number</code> | simple value attributes or the id |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+count"></a>

### eventQueue.count(attrs, [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Count of search results

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>count</code>](#JsonModel+count)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the count  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+numAggOp"></a>

### eventQueue.numAggOp(op, colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Numeric Aggregate Operation

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>numAggOp</code>](#JsonModel+numAggOp)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| op | <code>string</code> | the SQL function, e.g. MAX |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+max"></a>

### eventQueue.max(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Maximum value

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>max</code>](#JsonModel+max)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+min"></a>

### eventQueue.min(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Minimum value

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>min</code>](#JsonModel+min)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+sum"></a>

### eventQueue.sum(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Sum values

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>sum</code>](#JsonModel+sum)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+avg"></a>

### eventQueue.avg(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Average value

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>avg</code>](#JsonModel+avg)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+all"></a>

### eventQueue.all() ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
Get all objects

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>all</code>](#JsonModel+all)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the table contents  
<a name="JsonModel+get"></a>

### eventQueue.get(id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>get</code>](#JsonModel+get)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getAll"></a>

### eventQueue.getAll(ids, [colName]) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
Get several objects by their unique value, like their ID

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>getAll</code>](#JsonModel+getAll)  
**Returns**: <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code> - - the objects, or null where they don't exist, in order of their requested ID  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| ids | <code>array.&lt;\*&gt;</code> |  | the values for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getCached"></a>

### eventQueue.getCached([cache], id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID, using a cache.
This also coalesces multiple calls in the same tick into a single query,
courtesy of DataLoader.

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>getCached</code>](#JsonModel+getCached)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+clearCache"></a>

### eventQueue.clearCache([cache], id, [colName]) ⇒ <code>DataLoader</code>
Lets you clear all the cache or just a key. Useful for when you
change only some items

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>clearCache</code>](#JsonModel+clearCache)  
**Returns**: <code>DataLoader</code> - - the actual cache, you can call `.prime(key, value)` on it to insert a value  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+update"></a>

### eventQueue.update(obj, [upsert], [noReturn]) ⇒ <code>Promise.&lt;(object\|undefined)&gt;</code>
Update or upsert an object

**Kind**: instance method of [<code>EventQueue</code>](#EventQueue)  
**Overrides**: [<code>update</code>](#JsonModel+update)  
**Returns**: <code>Promise.&lt;(object\|undefined)&gt;</code> - A copy of the stored object  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The changes to store, including the id field |
| [upsert] | <code>boolean</code> | Insert the object if it doesn't exist |
| [noReturn] | <code>boolean</code> | Do not return the stored object |

<a name="DB"></a>

## DB ⇐ [<code>SQLite</code>](#SQLite)
DB adds model management and migrations to Wrapper.
The migration state is kept in the table ""{sdb} migrations"".

**Kind**: global class  
**Extends**: [<code>SQLite</code>](#SQLite)  

* [DB](#DB) ⇐ [<code>SQLite</code>](#SQLite)
    * [new DB(options)](#new_DB_new)
    * [.addModel(Model, options)](#DB+addModel) ⇒ <code>object</code>
    * [.registerMigrations(name, migrations)](#DB+registerMigrations) ⇒ <code>void</code>
    * [.runMigrations(db)](#DB+runMigrations) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.open()](#SQLite+open) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.close()](#SQLite+close) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.all(sql, [vars])](#SQLite+all) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
    * [.get(sql, [vars])](#SQLite+get) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.run(sql, [vars])](#SQLite+run) ⇒ <code>Promise.&lt;object&gt;</code>
    * [.exec(sql, [vars])](#SQLite+exec) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.prepare(sql, [name])](#SQLite+prepare) ⇒ <code>Statement</code>
    * [.each(sql, [vars], cb(row))](#SQLite+each) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.dataVersion()](#SQLite+dataVersion) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.userVersion([newV])](#SQLite+userVersion) ⇒ <code>Promise.&lt;(number\|void)&gt;</code>
    * [.withTransaction(fn)](#SQLite+withTransaction) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="new_DB_new"></a>

### new DB(options)

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | options for DB and SQLite |
| [options.readOnly] | <code>boolean</code> | open the DB read-only |
| [options.migrations] | <code>Array</code> | migration definitions |
| [options.onBeforeMigrations] | <code>function</code> | called with the `db` before migrations run. Not called for read-only |
| [options.onDidOpen] | <code>function</code> | called with the `db` after migrations ran. If readOnly is set, it runs after opening DB. The DB is open after this function resolves |

<a name="DB+addModel"></a>

### dB.addModel(Model, options) ⇒ <code>object</code>
Add a model to the DB, which will manage one or more tables in the SQLite database.
The model should use the given `db` instance at creation time.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Returns**: <code>object</code> - - the created Model instance  

| Param | Type | Description |
| --- | --- | --- |
| Model | <code>Object</code> | a class |
| options | <code>object</code> | options passed during Model creation |

<a name="DB+registerMigrations"></a>

### dB.registerMigrations(name, migrations) ⇒ <code>void</code>
Register an object with migrations

**Kind**: instance method of [<code>DB</code>](#DB)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name under which to register these migrations |
| migrations | <code>object.&lt;object.&lt;function()&gt;&gt;</code> | the migrations object |

<a name="DB+runMigrations"></a>

### dB.runMigrations(db) ⇒ <code>Promise.&lt;void&gt;</code>
Runs the migrations in a transaction and waits for completion

**Kind**: instance method of [<code>DB</code>](#DB)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - promise for completed migrations  

| Param | Type | Description |
| --- | --- | --- |
| db | [<code>SQLite</code>](#SQLite) | an opened SQLite instance |

<a name="SQLite+open"></a>

### dB.open() ⇒ <code>Promise.&lt;void&gt;</code>
Force opening the database instead of doing it lazily on first access

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>open</code>](#SQLite+open)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for the DB being ready to use  
<a name="SQLite+close"></a>

### dB.close() ⇒ <code>Promise.&lt;void&gt;</code>
Close the database connection, including the prepared statements

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>close</code>](#SQLite+close)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for the DB being closed  
<a name="SQLite+all"></a>

### dB.all(sql, [vars]) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
Return all rows for the given query

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>all</code>](#SQLite+all)  
**Returns**: <code>Promise.&lt;Array.&lt;object&gt;&gt;</code> - - the results  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+get"></a>

### dB.get(sql, [vars]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Return the first row for the given query

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>get</code>](#SQLite+get)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the result or falsy if missing  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+run"></a>

### dB.run(sql, [vars]) ⇒ <code>Promise.&lt;object&gt;</code>
Run the given query and return the metadata

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>run</code>](#SQLite+run)  
**Returns**: <code>Promise.&lt;object&gt;</code> - - an object with `lastID` and `changes`  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+exec"></a>

### dB.exec(sql, [vars]) ⇒ <code>Promise.&lt;void&gt;</code>
Run the given query and return nothing. Slightly more efficient than [run](run)

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>exec</code>](#SQLite+exec)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for execution completion  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+prepare"></a>

### dB.prepare(sql, [name]) ⇒ <code>Statement</code>
Register an SQL statement for repeated running. This will store the SQL
and will prepare the statement with SQLite whenever needed, as well as
finalize it when closing the connection.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>prepare</code>](#SQLite+prepare)  
**Returns**: <code>Statement</code> - - the statement  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [name] | <code>string</code> | a short name to use in debug logs |

<a name="SQLite+each"></a>

### dB.each(sql, [vars], cb(row)) ⇒ <code>Promise.&lt;void&gt;</code>
Run the given query and call the function on each item.
Note that node-sqlite3 seems to just fetch all data in one go.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>each</code>](#SQLite+each)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for execution completion  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |
| cb(row) | <code>function</code> | the function to call on each row |

<a name="SQLite+dataVersion"></a>

### dB.dataVersion() ⇒ <code>Promise.&lt;number&gt;</code>
Returns the data_version, which increases when other connections write
to the database.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>dataVersion</code>](#SQLite+dataVersion)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the data version  
<a name="SQLite+userVersion"></a>

### dB.userVersion([newV]) ⇒ <code>Promise.&lt;(number\|void)&gt;</code>
Returns or sets the user_version, an arbitrary integer connected
to the database.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>userVersion</code>](#SQLite+userVersion)  
**Returns**: <code>Promise.&lt;(number\|void)&gt;</code> - - the user version or nothing when setting  

| Param | Type | Description |
| --- | --- | --- |
| [newV] | <code>number</code> | if given, sets the user version |

<a name="SQLite+withTransaction"></a>

### dB.withTransaction(fn) ⇒ <code>Promise.&lt;void&gt;</code>
Run a function in an immediate transaction. Within a connection, the invocations
are serialized, and between connections it uses busy retry waiting. During a
transaction, the database can still be read.

**Kind**: instance method of [<code>DB</code>](#DB)  
**Overrides**: [<code>withTransaction</code>](#SQLite+withTransaction)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for transaction completion.  
**Throws**:

- - when the transaction fails or after too many retries


| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | the function to call. It doesn't get any parameters |

<a name="SQLite"></a>

## SQLite ⇐ <code>EventEmitter</code>
SQLite is a wrapper around a single SQLite connection (via node-sqlite3).
It provides a Promise API, lazy opening, auto-cleaning prepared statements
and safe ``db.run`select * from foo where bar=${bar}` `` templating.

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  

* [SQLite](#SQLite) ⇐ <code>EventEmitter</code>
    * [new SQLite(options)](#new_SQLite_new)
    * [.open()](#SQLite+open) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.close()](#SQLite+close) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.all(sql, [vars])](#SQLite+all) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
    * [.get(sql, [vars])](#SQLite+get) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.run(sql, [vars])](#SQLite+run) ⇒ <code>Promise.&lt;object&gt;</code>
    * [.exec(sql, [vars])](#SQLite+exec) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.prepare(sql, [name])](#SQLite+prepare) ⇒ <code>Statement</code>
    * [.each(sql, [vars], cb(row))](#SQLite+each) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.dataVersion()](#SQLite+dataVersion) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.userVersion([newV])](#SQLite+userVersion) ⇒ <code>Promise.&lt;(number\|void)&gt;</code>
    * [.withTransaction(fn)](#SQLite+withTransaction) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="new_SQLite_new"></a>

### new SQLite(options)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | - |
| [options.file] | <code>string</code> |  | path to db file |
| [options.readOnly] | <code>boolean</code> |  | open read-only |
| [options.verbose] | <code>boolean</code> |  | verbose errors |
| [options.onWillOpen] | <code>function</code> |  | called before opening |
| [options.onDidOpen] | <code>function</code> |  | called after opened |
| [options.name] | <code>string</code> |  | name for debugging |
| [options.autoVacuum] | <code>boolean</code> |  | run incremental vacuum |
| [options.vacuumInterval] | <code>number</code> |  | seconds between incremental vacuums |
| [options.vacuumPageCount] | <code>number</code> |  | number of pages to clean per vacuum |
| [options._sqlite] | <code>object</code> |  | sqlite instance for child dbs |
| [options._store] | <code>object</code> | <code>{}</code> | models registry for child dbs |
| [options._statements] | <code>object</code> | <code>{}</code> | statements registry for child dbs |

<a name="SQLite+open"></a>

### sqLite.open() ⇒ <code>Promise.&lt;void&gt;</code>
Force opening the database instead of doing it lazily on first access

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for the DB being ready to use  
<a name="SQLite+close"></a>

### sqLite.close() ⇒ <code>Promise.&lt;void&gt;</code>
Close the database connection, including the prepared statements

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for the DB being closed  
<a name="SQLite+all"></a>

### sqLite.all(sql, [vars]) ⇒ <code>Promise.&lt;Array.&lt;object&gt;&gt;</code>
Return all rows for the given query

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;Array.&lt;object&gt;&gt;</code> - - the results  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+get"></a>

### sqLite.get(sql, [vars]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Return the first row for the given query

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the result or falsy if missing  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+run"></a>

### sqLite.run(sql, [vars]) ⇒ <code>Promise.&lt;object&gt;</code>
Run the given query and return the metadata

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;object&gt;</code> - - an object with `lastID` and `changes`  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+exec"></a>

### sqLite.exec(sql, [vars]) ⇒ <code>Promise.&lt;void&gt;</code>
Run the given query and return nothing. Slightly more efficient than [run](run)

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for execution completion  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |

<a name="SQLite+prepare"></a>

### sqLite.prepare(sql, [name]) ⇒ <code>Statement</code>
Register an SQL statement for repeated running. This will store the SQL
and will prepare the statement with SQLite whenever needed, as well as
finalize it when closing the connection.

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Statement</code> - - the statement  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [name] | <code>string</code> | a short name to use in debug logs |

<a name="SQLite+each"></a>

### sqLite.each(sql, [vars], cb(row)) ⇒ <code>Promise.&lt;void&gt;</code>
Run the given query and call the function on each item.
Note that node-sqlite3 seems to just fetch all data in one go.

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for execution completion  

| Param | Type | Description |
| --- | --- | --- |
| sql | <code>string</code> | the SQL statement to be executed |
| [vars] | <code>Array.&lt;\*&gt;</code> | the variables to be bound to the statement |
| cb(row) | <code>function</code> | the function to call on each row |

<a name="SQLite+dataVersion"></a>

### sqLite.dataVersion() ⇒ <code>Promise.&lt;number&gt;</code>
Returns the data_version, which increases when other connections write
to the database.

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the data version  
<a name="SQLite+userVersion"></a>

### sqLite.userVersion([newV]) ⇒ <code>Promise.&lt;(number\|void)&gt;</code>
Returns or sets the user_version, an arbitrary integer connected
to the database.

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;(number\|void)&gt;</code> - - the user version or nothing when setting  

| Param | Type | Description |
| --- | --- | --- |
| [newV] | <code>number</code> | if given, sets the user version |

<a name="SQLite+withTransaction"></a>

### sqLite.withTransaction(fn) ⇒ <code>Promise.&lt;void&gt;</code>
Run a function in an immediate transaction. Within a connection, the invocations
are serialized, and between connections it uses busy retry waiting. During a
transaction, the database can still be read.

**Kind**: instance method of [<code>SQLite</code>](#SQLite)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - a promise for transaction completion.  
**Throws**:

- - when the transaction fails or after too many retries


| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | the function to call. It doesn't get any parameters |

<a name="ESModel"></a>

## ESModel ⇐ [<code>JsonModel</code>](#JsonModel)
ESModel is a drop-in wrapper around JsonModel to turn changes into events.

Use it to convert your database to be event sourcing

Event data is encoded as an array: `[subtype, id, data, meta]`
Subtype is one of `ESModel.(REMOVE|SET|INSERT|UPDATE|SAVE)`.
`id` is filled in by the preprocessor at the time of the event.
`meta` is free-form data about the event. It is just stored in the history table.

For example: `model.set({foo: true})` would result in the event
`[1, 1, {foo: true}]`

**Kind**: global class  
**Extends**: [<code>JsonModel</code>](#JsonModel)  

* [ESModel](#ESModel) ⇐ [<code>JsonModel</code>](#JsonModel)
    * [new ESModel(dispatch, [init])](#new_ESModel_new)
    * _instance_
        * [.parseRow](#JsonModel+parseRow) ⇒ <code>object</code>
        * [.setWritable(state)](#ESModel+setWritable)
        * [.set(obj, [insertOnly], [noReturn], [meta])](#ESModel+set) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.update(o, [upsert], [noReturn], [meta])](#ESModel+update) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.remove(idOrObj, meta)](#ESModel+remove) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.changeId()](#ESModel+changeId)
        * [.getNextId()](#ESModel+getNextId) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.applyResult(result)](#ESModel+applyResult) ⇒ <code>Promise.&lt;void&gt;</code>
        * [.makeSelect(options)](#JsonModel+makeSelect)
        * [.searchOne(attrs, options)](#JsonModel+searchOne) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
        * [.search(attrs, [options])](#JsonModel+search) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
        * [.searchAll(attrs, [options])](#JsonModel+searchAll) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
        * [.exists(attrs, [options])](#JsonModel+exists) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.count(attrs, [options])](#JsonModel+count) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.numAggOp(op, colName, [attrs], [options])](#JsonModel+numAggOp) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.max(colName, [attrs], [options])](#JsonModel+max) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.min(colName, [attrs], [options])](#JsonModel+min) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.sum(colName, [attrs], [options])](#JsonModel+sum) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.avg(colName, [attrs], [options])](#JsonModel+avg) ⇒ <code>Promise.&lt;number&gt;</code>
        * [.all()](#JsonModel+all) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
        * [.get(id, [colName])](#JsonModel+get) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
        * [.getAll(ids, [colName])](#JsonModel+getAll) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
        * [.getCached([cache], id, [colName])](#JsonModel+getCached) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
        * [.clearCache([cache], id, [colName])](#JsonModel+clearCache) ⇒ <code>DataLoader</code>
    * _static_
        * [.preprocessor()](#ESModel.preprocessor)
        * [.reducer(model, event)](#ESModel.reducer) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_ESModel_new"></a>

### new ESModel(dispatch, [init])
Creates a new ESModel model, called by DB


| Param | Type | Description |
| --- | --- | --- |
| dispatch | <code>function</code> | the [ESDB](ESDB) dispatch function |
| [init] | <code>boolean</code> | emit an event with type `es/INIT:${modelname}` at table creation time, to be used by custom reducers |
| [...options] | <code>Object</code> | other params are passed to JsonModel |

<a name="JsonModel+parseRow"></a>

### esModel.parseRow ⇒ <code>object</code>
parses a row as returned by sqlite

**Kind**: instance property of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>parseRow</code>](#JsonModel+parseRow)  
**Returns**: <code>object</code> - - the resulting object (document)  

| Param | Type | Description |
| --- | --- | --- |
| row | <code>object</code> | result from sqlite |
| options | <code>object</code> | an object possibly containing the `cols` array with the desired column names |

<a name="ESModel+setWritable"></a>

### esModel.setWritable(state)
Slight hack: use the writable state to fall back to JsonModel behavior.
This makes deriver and migrations work without changes.
Note: while writable, no events are created. Be careful.

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>boolean</code> | writeable or not |

<a name="ESModel+set"></a>

### esModel.set(obj, [insertOnly], [noReturn], [meta]) ⇒ <code>Promise.&lt;Object&gt;</code>
Insert or replace the given object into the database

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - if `noReturn` is false, the stored object is fetched from the DB  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | the object to store. If there is no `id` value (or whatever the `id` column is named), one is assigned automatically. |
| [insertOnly] | <code>boolean</code> | don't allow replacing existing objects |
| [noReturn] | <code>boolean</code> | do not return the stored object; an optimization |
| [meta] | <code>\*</code> | extra metadata to store in the event but not in the object |

<a name="ESModel+update"></a>

### esModel.update(o, [upsert], [noReturn], [meta]) ⇒ <code>Promise.&lt;Object&gt;</code>
update an existing object

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>update</code>](#JsonModel+update)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - if `noReturn` is false, the stored object is fetched from the DB  

| Param | Type | Description |
| --- | --- | --- |
| o | <code>Object</code> | the data to store |
| [upsert] | <code>boolean</code> | if `true`, allow inserting if the object doesn't exist |
| [noReturn] | <code>boolean</code> | do not return the stored object; an optimization |
| [meta] | <code>\*</code> | extra metadata to store in the event at `data[3]` but not in the object |

<a name="ESModel+remove"></a>

### esModel.remove(idOrObj, meta) ⇒ <code>Promise.&lt;boolean&gt;</code>
Remove an object

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - - always returns true  

| Param | Type | Description |
| --- | --- | --- |
| idOrObj | <code>Object</code> \| <code>string</code> \| <code>integer</code> | the id or the object itself |
| meta | <code>\*</code> | metadata, attached to the event only, at `data[3]` |

<a name="ESModel+changeId"></a>

### esModel.changeId()
changeId: not implemented yet, had no need so far

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
<a name="ESModel+getNextId"></a>

### esModel.getNextId() ⇒ <code>Promise.&lt;number&gt;</code>
Returns the next available integer ID for the model.
Calling this multiple times during a redux cycle will give increasing numbers
even though the database table doesn't change.
Use this from the redux functions to assign unique ids to new objects.

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the next usable ID  
<a name="ESModel+applyResult"></a>

### esModel.applyResult(result) ⇒ <code>Promise.&lt;void&gt;</code>
Applies the result from the reducer

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Returns**: <code>Promise.&lt;void&gt;</code> - - Promise for completion  

| Param | Type | Description |
| --- | --- | --- |
| result | <code>Object</code> | free-form change descriptor |

<a name="JsonModel+makeSelect"></a>

### esModel.makeSelect(options)
Parses query options into query parts. Override this function to implement search behaviors.

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>makeSelect</code>](#JsonModel+makeSelect)  

| Param | Type | Description |
| --- | --- | --- |
| options | [<code>SearchOptions</code>](#SearchOptions) | the query options |

<a name="JsonModel+searchOne"></a>

### esModel.searchOne(attrs, options) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Search the first matching object

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>searchOne</code>](#JsonModel+searchOne)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the result or null if no match  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| options | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+search"></a>

### esModel.search(attrs, [options]) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
Search the all matching objects

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>search</code>](#JsonModel+search)  
**Returns**: <code>Promise.&lt;(object\|array)&gt;</code> - - `{items[], cursor}`. If no cursor, you got all the results. If `itemsOnly`, returns only the items array.  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |
| [options.itemsOnly] | <code>boolean</code> | return only the items array |

<a name="JsonModel+searchAll"></a>

### esModel.searchAll(attrs, [options]) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
A shortcut for setting `itemsOnly: true` on [search](search)

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>searchAll</code>](#JsonModel+searchAll)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the search results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+exists"></a>

### esModel.exists(attrs, [options]) ⇒ <code>Promise.&lt;boolean&gt;</code>
Check for existence of objects

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>exists</code>](#JsonModel+exists)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - - `true` if the search would have results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> \| <code>string</code> \| <code>number</code> | simple value attributes or the id |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+count"></a>

### esModel.count(attrs, [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Count of search results

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>count</code>](#JsonModel+count)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the count  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+numAggOp"></a>

### esModel.numAggOp(op, colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Numeric Aggregate Operation

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>numAggOp</code>](#JsonModel+numAggOp)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| op | <code>string</code> | the SQL function, e.g. MAX |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+max"></a>

### esModel.max(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Maximum value

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>max</code>](#JsonModel+max)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+min"></a>

### esModel.min(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Minimum value

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>min</code>](#JsonModel+min)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+sum"></a>

### esModel.sum(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Sum values

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>sum</code>](#JsonModel+sum)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+avg"></a>

### esModel.avg(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Average value

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>avg</code>](#JsonModel+avg)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+all"></a>

### esModel.all() ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
Get all objects

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>all</code>](#JsonModel+all)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the table contents  
<a name="JsonModel+get"></a>

### esModel.get(id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>get</code>](#JsonModel+get)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getAll"></a>

### esModel.getAll(ids, [colName]) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
Get several objects by their unique value, like their ID

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>getAll</code>](#JsonModel+getAll)  
**Returns**: <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code> - - the objects, or null where they don't exist, in order of their requested ID  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| ids | <code>array.&lt;\*&gt;</code> |  | the values for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getCached"></a>

### esModel.getCached([cache], id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID, using a cache.
This also coalesces multiple calls in the same tick into a single query,
courtesy of DataLoader.

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>getCached</code>](#JsonModel+getCached)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+clearCache"></a>

### esModel.clearCache([cache], id, [colName]) ⇒ <code>DataLoader</code>
Lets you clear all the cache or just a key. Useful for when you
change only some items

**Kind**: instance method of [<code>ESModel</code>](#ESModel)  
**Overrides**: [<code>clearCache</code>](#JsonModel+clearCache)  
**Returns**: <code>DataLoader</code> - - the actual cache, you can call `.prime(key, value)` on it to insert a value  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="ESModel.preprocessor"></a>

### ESModel.preprocessor()
Assigns the object id to the event at the start of the cycle.
When subclassing ESModel, be sure to call this too (`ESModel.preprocessor(arg)`)

**Kind**: static method of [<code>ESModel</code>](#ESModel)  
<a name="ESModel.reducer"></a>

### ESModel.reducer(model, event) ⇒ <code>Promise.&lt;Object&gt;</code>
Calculates the desired change
ESModel will only emit `rm`, `ins`, `upd` and `esFail`

**Kind**: static method of [<code>ESModel</code>](#ESModel)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - the result object in the format JsonModel likes  

| Param | Type | Description |
| --- | --- | --- |
| model | <code>object</code> | the model |
| event | [<code>Event</code>](#Event) | the event |

<a name="EventSourcingDB"></a>

## EventSourcingDB ⇐ <code>EventEmitter</code>
EventSourcingDB maintains a DB where all data is
atomically updated based on [events (free-form messages)](#Event).
This is very similar to how Redux works in React.

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
<a name="JsonModel"></a>

## JsonModel
JsonModel is a simple document store. It stores its data in SQLite as a table, one row
per object (document). Each object must have a unique ID, normally at `obj.id`.

**Kind**: global class  

* [JsonModel](#JsonModel)
    * [new JsonModel(options)](#new_JsonModel_new)
    * [.parseRow](#JsonModel+parseRow) ⇒ <code>object</code>
    * [.makeSelect(options)](#JsonModel+makeSelect)
    * [.searchOne(attrs, options)](#JsonModel+searchOne) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.search(attrs, [options])](#JsonModel+search) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
    * [.searchAll(attrs, [options])](#JsonModel+searchAll) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
    * [.exists(attrs, [options])](#JsonModel+exists) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [.count(attrs, [options])](#JsonModel+count) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.numAggOp(op, colName, [attrs], [options])](#JsonModel+numAggOp) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.max(colName, [attrs], [options])](#JsonModel+max) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.min(colName, [attrs], [options])](#JsonModel+min) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.sum(colName, [attrs], [options])](#JsonModel+sum) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.avg(colName, [attrs], [options])](#JsonModel+avg) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.all()](#JsonModel+all) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
    * [.get(id, [colName])](#JsonModel+get) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.getAll(ids, [colName])](#JsonModel+getAll) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
    * [.getCached([cache], id, [colName])](#JsonModel+getCached) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
    * [.clearCache([cache], id, [colName])](#JsonModel+clearCache) ⇒ <code>DataLoader</code>
    * [.update(obj, [upsert], [noReturn])](#JsonModel+update) ⇒ <code>Promise.&lt;(object\|undefined)&gt;</code>

<a name="new_JsonModel_new"></a>

### new JsonModel(options)
Creates a new JsonModel instance


| Param | Type | Description |
| --- | --- | --- |
| options | [<code>JMOptions</code>](#JMOptions) | the model declaration |

<a name="JsonModel+parseRow"></a>

### jsonModel.parseRow ⇒ <code>object</code>
parses a row as returned by sqlite

**Kind**: instance property of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>object</code> - - the resulting object (document)  

| Param | Type | Description |
| --- | --- | --- |
| row | <code>object</code> | result from sqlite |
| options | <code>object</code> | an object possibly containing the `cols` array with the desired column names |

<a name="JsonModel+makeSelect"></a>

### jsonModel.makeSelect(options)
Parses query options into query parts. Override this function to implement search behaviors.

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  

| Param | Type | Description |
| --- | --- | --- |
| options | [<code>SearchOptions</code>](#SearchOptions) | the query options |

<a name="JsonModel+searchOne"></a>

### jsonModel.searchOne(attrs, options) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Search the first matching object

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the result or null if no match  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| options | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+search"></a>

### jsonModel.search(attrs, [options]) ⇒ <code>Promise.&lt;(object\|array)&gt;</code>
Search the all matching objects

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;(object\|array)&gt;</code> - - `{items[], cursor}`. If no cursor, you got all the results. If `itemsOnly`, returns only the items array.  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |
| [options.itemsOnly] | <code>boolean</code> | return only the items array |

<a name="JsonModel+searchAll"></a>

### jsonModel.searchAll(attrs, [options]) ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
A shortcut for setting `itemsOnly: true` on [search](search)

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the search results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+exists"></a>

### jsonModel.exists(attrs, [options]) ⇒ <code>Promise.&lt;boolean&gt;</code>
Check for existence of objects

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - - `true` if the search would have results  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> \| <code>string</code> \| <code>number</code> | simple value attributes or the id |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+count"></a>

### jsonModel.count(attrs, [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Count of search results

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the count  

| Param | Type | Description |
| --- | --- | --- |
| attrs | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+numAggOp"></a>

### jsonModel.numAggOp(op, colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Numeric Aggregate Operation

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| op | <code>string</code> | the SQL function, e.g. MAX |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+max"></a>

### jsonModel.max(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Maximum value

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+min"></a>

### jsonModel.min(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Minimum value

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+sum"></a>

### jsonModel.sum(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Sum values

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+avg"></a>

### jsonModel.avg(colName, [attrs], [options]) ⇒ <code>Promise.&lt;number&gt;</code>
Average value

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;number&gt;</code> - - the result  

| Param | Type | Description |
| --- | --- | --- |
| colName | <code>string</code> | column to aggregate |
| [attrs] | <code>object</code> | simple value attributes |
| [options] | [<code>SearchOptions</code>](#SearchOptions) | search options |

<a name="JsonModel+all"></a>

### jsonModel.all() ⇒ <code>Promise.&lt;array.&lt;object&gt;&gt;</code>
Get all objects

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;array.&lt;object&gt;&gt;</code> - - the table contents  
<a name="JsonModel+get"></a>

### jsonModel.get(id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getAll"></a>

### jsonModel.getAll(ids, [colName]) ⇒ <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code>
Get several objects by their unique value, like their ID

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;array.&lt;(object\|null)&gt;&gt;</code> - - the objects, or null where they don't exist, in order of their requested ID  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| ids | <code>array.&lt;\*&gt;</code> |  | the values for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+getCached"></a>

### jsonModel.getCached([cache], id, [colName]) ⇒ <code>Promise.&lt;(object\|null)&gt;</code>
Get an object by a unique value, like its ID, using a cache.
This also coalesces multiple calls in the same tick into a single query,
courtesy of DataLoader.

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;(object\|null)&gt;</code> - - the object if it exists  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+clearCache"></a>

### jsonModel.clearCache([cache], id, [colName]) ⇒ <code>DataLoader</code>
Lets you clear all the cache or just a key. Useful for when you
change only some items

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>DataLoader</code> - - the actual cache, you can call `.prime(key, value)` on it to insert a value  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [cache] | <code>object</code> |  | the lookup cache. It is managed with DataLoader |
| id | <code>\*</code> |  | the value for the column |
| [colName] | <code>string</code> | <code>&quot;this.idCol&quot;</code> | the columnname, defaults to the ID column |

<a name="JsonModel+update"></a>

### jsonModel.update(obj, [upsert], [noReturn]) ⇒ <code>Promise.&lt;(object\|undefined)&gt;</code>
Update or upsert an object

**Kind**: instance method of [<code>JsonModel</code>](#JsonModel)  
**Returns**: <code>Promise.&lt;(object\|undefined)&gt;</code> - A copy of the stored object  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>object</code> | The changes to store, including the id field |
| [upsert] | <code>boolean</code> | Insert the object if it doesn't exist |
| [noReturn] | <code>boolean</code> | Do not return the stored object |

<a name="sql"></a>

## sql ⇒ <code>array</code>
sql provides templating for SQL.

Example:
  `` db.all`select * from ${'foo'}ID where ${'t'}LIT = ${bar} AND json = ${obj}JSON` ``

is converted to
  `db.all('select * from "foo" where t = ? and json = ?', [bar, JSON.stringify(obj)])`

**Kind**: global constant  
**Returns**: <code>array</code> - - [out, variables] for consumption by the call method  

| Param | Type | Description |
| --- | --- | --- |
| template | <code>Array.&lt;string&gt;</code> | the template |
| ...interpolations | <code>any</code> | the template interpolations |

<a name="Event"></a>

## Event : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| v | <code>Number</code> | the version |
| type | <code>String</code> | event type |
| ts | <code>Number</code> | ms since epoch of event |
| [data] | <code>\*</code> | event data |
| [result] | <code>Object</code> | event processing result |

<a name="voidFn"></a>

## voidFn ⇒ <code>Promise.&lt;\*&gt;</code> \| <code>\*</code>
**Kind**: global typedef  
<a name="SearchOptions"></a>

## SearchOptions : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| [attrs] | <code>object</code> | literal value search, for convenience |
| [where] | <code>object.&lt;array.&lt;\*&gt;&gt;</code> | sql expressions as keys with arrays of applicable parameters as values |
| [join] | <code>string</code> | arbitrary join clause. Not processed at all |
| [joinVals] | <code>array.&lt;\*&gt;</code> | values needed by the join clause |
| [sort] | <code>object</code> | object with sql expressions as keys and 1/-1 for direction |
| [limit] | <code>number</code> | max number of rows to return |
| [offset] | <code>number</code> | number of rows to skip |
| [cols] | <code>array.&lt;string&gt;</code> | override the columns to select |
| [cursor] | <code>string</code> | opaque value telling from where to continue |
| [noCursor] | <code>boolean</code> | do not calculate cursor |
| [noTotal] | <code>boolean</code> | do not calculate totals |

<a name="ColumnDef"></a>

## ColumnDef : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| [real] | <code>boolean</code> | <code>!!type</code> | is this a real table column |
| [type] | <code>string</code> |  | sql column type as accepted by [DB](#DB) |
| [path] | <code>string</code> |  | path to the value in the object |
| [autoIncrement] | <code>boolean</code> |  | INTEGER id column only: apply AUTOINCREMENT on the column |
| [alias] | <code>string</code> |  | the alias to use in SELECT statements |
| [get] | <code>boolean</code> | <code>true</code> | should the column be included in search results |
| [parse] | <code>function</code> |  | process the value after getting from DB |
| [stringify] | <code>function</code> |  | process the value before putting into DB |
| [alwaysObject] | <code>boolean</code> |  | the value is an object and must always be there. If this is a real column, a NULL column value will be replaced by `{}` and vice versa. |
| [value] | <code>function</code> |  | function getting object and returning the value for the column; this creates a real column. Right now the column value is not regenerated for existing rows. |
| [slugValue] | <code>function</code> |  | same as value, but the result is used to generate a unique slug |
| [sql] | <code>string</code> |  | any sql expression to use in SELECT statements |
| [default] | <code>\*</code> |  | if the value is nullish, this will be stored instead |
| [required] | <code>boolean</code> |  | throw when trying to store a NULL |
| [falsyBool] | <code>boolean</code> |  | store/retrieve this boolean value as either `true` or absent from the object |
| [index] | <code>boolean</code> |  | should it be indexed? If `unique` is false, NULLs are never indexed |
| [ignoreNull] | <code>boolean</code> | <code>!unique</code> | are null values ignored in the index? |
| [unique] | <code>boolean</code> |  | should the index enforce uniqueness? |
| [whereVal] | <code>function</code> |  | a function returning the `vals` give to `where`. It should return falsy or an array of values. |
| [where] | <code>string</code> \| <code>function</code> |  | the where clause for querying, or a function returning one given `(vals, origVals)` |
| [isArray] | <code>boolean</code> |  | this column contains an array of values |
| [in] | <code>boolean</code> |  | to query, this column value must match one of the given array items |
| [inAll] | <code>boolean</code> |  | [isArray only] to query, this column value must match all of the given array items |
| [textSearch] | <code>boolean</code> |  | perform searches as substring search with LIKE |
| [isAnyOfArray] | <code>boolean</code> |  | alias for isArray+inAll |

<a name="JMOptions"></a>

## JMOptions : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| db | [<code>DB</code>](#DB) |  | a DB instance, normally passed by DB |
| name | <code>string</code> |  | the table name |
| [migrations] | <code>Object</code> |  | an object with migration functions. They are ran in alphabetical order |
| [migrationOptions] | <code>Object</code> |  | free-form data passed to the migration functions |
| [columns] | <code>Object</code> |  | the column definitions as [ColumnDef](#ColumnDef) objects. Each value must be a columndef or a function returning a columndef. |
| [ItemClass] | <code>function</code> |  | an object class to use for results, must be able to handle `Object.assign(item, result)` |
| [idCol] | <code>string</code> | <code>&quot;&#x27;id&#x27;&quot;</code> | the key of the ID column |
| [keepRowId] | <code>boolean</code> |  | preserve row id after vacuum |


_Generated from 04ebc5c64552a4747c2655f63c82d39a29bfbd60, 2020-03-05T10:23:13+01:00_