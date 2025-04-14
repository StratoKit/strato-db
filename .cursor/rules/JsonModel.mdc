# JsonModel Module (`src/JsonModel`)

This module provides the `JsonModel` class, a powerful Object-Relational Mapper (ORM)-like interface for storing and querying JSON-style documents within SQLite tables.

## Core Components

### `JsonModel.js` (`JsonModelImpl` class)

- **Purpose:** Manages a specific SQLite table, mapping rows to JavaScript objects. It handles schema definition, data serialization/deserialization, CRUD operations, querying, indexing, migrations, and caching.
- **Key Features:**
    - **Schema Definition:** Defines table structure through a `columns` object, supporting various data types (TEXT, INTEGER, JSON, etc.), primary keys (`idCol`), automatic value generation (`value`), indexing (`index`), and aliasing.
    - **JSON Handling:** Stores primary data in a `json` column but can extract specific JSON paths (`path`) into virtual columns for efficient querying and indexing.
    - **CRUD:** Provides comprehensive methods:
        - `set()`: Inserts or updates (upserts) an object.
        - `get()`: Retrieves an object by its ID.
        - `getAll()`: Retrieves multiple objects by IDs.
        - `update()`: Updates an existing object.
        - `remove()` / `delete()`: Deletes an object by ID or the object itself.
        - `changeId()`: Updates the ID of an object.
    - **Querying:** Offers flexible search capabilities:
        - `search()`, `searchOne()`, `searchAll()`: Finds objects based on attribute matching (`where`), sorting (`sort`), limiting results (`limit`), and cursor-based pagination.
        - `exists()`: Checks if an object matching criteria exists.
        - `count()`: Counts matching objects.
        - Aggregate functions: `max()`, `min()`, `sum()`, `avg()`.
    - **Caching:** Integrates `dataloader` for efficient batching and caching of `get` operations via `getCached()`.
    - **Migrations:** Manages database schema evolution through registered migration functions.
    - **Customization:** Allows specifying a custom class (`ItemClass`) for instantiated objects.
    - **Utilities:** Includes internal helpers for SQL generation, object cloning, cursor encoding/decoding (`jsurl2`).
- **Dependencies:** `DB` (likely via passed `db` instance), `dataloader`, `lodash`, `debug`, `jsurl2`, internal helpers.

### Helper Modules

- `normalizeColumn.js`: Standardizes column definitions.
- `prepareSqlCol.js`: Generates SQL snippets for columns, handles JSON path extraction.
- `verifyOptions.js`: Validates constructor options and column definitions.
- `makeMigrations.js`: Constructs migration steps based on schema definition.
- `makeDefaultIdValue.js`: Creates default value generation logic for ID columns.
- `assignJsonParents.js`: Links JSON path columns to their parent JSON column.

## Usage

1.  Instantiate `JsonModel` with database connection (`db`), table `name`, and `columns` definition.
2.  Use methods like `set()`, `get()`, `search()`, `update()`, `remove()` to interact with the data.
3.  Leverage caching (`getCached()`) for performance-sensitive reads.
4.  Define migrations to handle schema changes over time.

## Dependencies

- `dataloader`: For batching and caching reads.
- `lodash`: General utility functions.
- `debug`: For logging.
- `jsurl2`: For compact URL-safe JSON serialization (used for cursors).
- `DB` module components (implicitly via the `db` instance).

## Structure

```
src/
└── JsonModel/
    ├── JsonModel.js         # Main class implementation
    ├── JM-*.test.js         # Unit tests
    ├── normalizeColumn.js   # Helper
    ├── prepareSqlCol.js     # Helper
    ├── verifyOptions.js     # Helper
    ├── makeMigrations.js    # Helper
    ├── makeDefaultIdValue.js # Helper
    ├── assignJsonParents.js # Helper
    └── index.js             # Module entry point
```
