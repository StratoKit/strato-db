# EventQueue Module (`src/EventQueue.js`)

This module provides an event queue implementation, likely used for the event sourcing mechanism.

## Core Components

### `EventQueue.js`

- **Purpose:** Implements a persistent event queue backed by a SQLite table (defaulting to `history`). It extends `JsonModel`, suggesting it leverages the JSON storage capabilities.
- **Key Features:**
    - Stores events with `v` (auto-incrementing version/ID), `type`, `ts` (timestamp), `data` (JSON), `result` (JSON), and `size` (calculated size of data/result).
    - Provides methods for adding events (`add`), retrieving the latest version (`getMaxV`), and fetching the next event after a specific version (`getNext`), including waiting for new events.
    - Includes database migrations for adding indices and helper views (`_recentHistory`, `_historyTypes`).
    - Manages internal state (`currentV`, `knownV`) for optimization.
    - Uses `debug` for logging.
    - Handles concurrency within the same process using Promises (`_addP`).
    - Optionally keeps the Node.js process alive while waiting (`forever: true`).
    - Allows customization of table name and columns.
- **Dependencies:** `JsonModel`, `debug`

## Usage

- Instantiate `EventQueue` (likely via `new EventQueueImpl(...)` although the export might simplify this).
- Use `add(type, data, [ts])` to append new events.
- Use `getMaxV()` to get the highest event version number.
- Use `getNext(v, [noWait])` to retrieve events sequentially, potentially waiting for new ones.

## Schema (Default `history` table)

- `v`: INTEGER PRIMARY KEY AUTOINCREMENT (Event version/ID)
- `type`: TEXT (Event type identifier)
- `ts`: INTEGER (Timestamp in milliseconds since epoch, indexed)
- `data`: JSON (Payload of the event)
- `result`: JSON (Result associated with processing the event, optional)
- `size`: INTEGER (Calculated size of `data` + `result` JSON strings)

## Dependencies

- `debug`: Used for logging.
- `JsonModel`: Base class providing JSON handling and DB interaction.

## Structure

```
src/
├── EventQueue.js      # Main EventQueue implementation
├── EventQueue.test.js
└── ... (other modules)
```
