# StratoDB Refactoring TODO List

This document outlines the necessary steps to refactor and modernize the `strato-db` codebase. The tasks are ordered to minimize disruption and build upon previous steps.

**Overall Goals:**

- Improve maintainability, readability, and type safety.
- Enhance performance by using a synchronous SQLite driver off the main thread.
- Provide a more user-friendly API.
- Ensure proper type definitions are generated for package consumers.

---

## Phase 1: Database Backend and Concurrency Model

**Goal:** Replace `sqlite3` with `better-sqlite3` and move all database operations to worker threads.

**Tasks:**

1.  **Install Dependencies:**

    - Remove `sqlite3`.
    - Add `better-sqlite3`.
    - Add a worker pool library (e.g., `piscina`) or implement a custom pool.

2.  **Design Worker Communication:**

    - Define the message format for commands (e.g., `run`, `get`, `all`, `exec`, `prepare`, transaction operations) and results/errors between the main thread and workers.
    - Decide on data transfer strategy (structured cloning vs. `SharedArrayBuffer` where applicable/beneficial, especially for reads returning large datasets). Consider the overhead of serialization.

3.  **Implement Worker Logic:**

    - Create worker script(s) that initialize `better-sqlite3` database connections.
    - Implement message handlers within the worker to execute corresponding `better-sqlite3` methods synchronously.
    - Handle database connection management within workers (opening, closing).
    - Ensure proper error handling and propagation back to the main thread.

4.  **Implement Worker Pool:**

    - Set up the worker pool (e.g., using `piscina`).
    - Configure pool size (consider read vs. write workers if necessary - writes _must_ be serialized per DB file, reads can often be parallelized). A single writer thread per database instance and multiple reader threads is a common pattern.

5.  **Refactor `DB`, `SQLite`, `Statement` Modules:**

    - Remove the existing `sqlite3`-based implementation (`src/DB/SQLite.js`, `src/DB/Statement.js`).
    - Modify `src/DB/DB.js` (or create a new abstraction) to interact with the worker pool instead of directly with the database.
    - All methods in this layer (`get`, `all`, `run`, `exec`, `prepare`, `transaction`, etc.) must become asynchronous, returning Promises that resolve/reject based on worker responses.
    - Adapt the `Statement` concept if needed, potentially managing prepared statements within specific workers or re-preparing as necessary. `better-sqlite3`'s statement caching might simplify this.

6.  **Update Dependent Modules:**
    - Modify `JsonModel`, `EventQueue`, and `EventSourcingDB` to use the new asynchronous DB layer methods (replace synchronous assumptions or promise-based `sqlite3` calls with `await` on the new worker-based calls).

**Considerations:**

- `better-sqlite3` is synchronous. All calls _must_ be offloaded to workers to avoid blocking the main thread.
- Transaction management across worker messages needs careful design. `better-sqlite3` transactions are synchronous within the worker. The main thread might send a "beginTransaction" command, followed by multiple operations, then "commit" or "rollback".
- Error handling across thread boundaries.
- Performance impact of data serialization/deserialization between threads.

---

## Phase 2: TypeScript Conversion

**Goal:** Convert the entire `src` directory to TypeScript and configure the build process for type generation.

**Tasks:**

1.  **Setup TypeScript Build:**

    - Ensure `typescript` and necessary `@types/*` packages are dev dependencies.
    - Configure `tsconfig.json` for compilation:
      - Set `outDir` (e.g., `./dist`).
      - Set `declaration: true` and `declarationDir` (e.g., `./dist/types` or `./dist`).
      - Set `module` to `NodeNext` (or similar modern target) to support both CJS and ESM output if needed, or configure separate builds.
      - Ensure `allowJs: false` (or remove it) once conversion is complete.
      - Set `rootDir: ./src`.
    - Configure `package.json`:
      - Define `types` field pointing to the main declaration file (e.g., `./dist/index.d.ts`).
      - Define `exports` field for proper CJS/ESM resolution.
      - Update build scripts (`"scripts": { "build": "tsc" }`). Ensure the build _only_ compiles (no bundling).

2.  **Convert Files Incrementally:**
    - Rename `.js` files in `src` to `.ts`.
    - Start adding types, beginning with core classes and functions. Leverage JSDoc annotations where present.
    - Address TypeScript compiler errors (`tsc --noEmit`).
    - Pay close attention to types related to the worker communication layer developed in Phase 1. Define clear interfaces for messages and results.
    - Convert test files (`.test.js` to `.test.ts`) and update test setup/configuration (e.g., `vite.config.ts` or `vitest.config.ts`) if necessary.

**Considerations:**

- Address `any` types progressively. Aim for strong typing.
- Use TypeScript features like interfaces, generics, enums effectively.
- Ensure generated `.d.ts` files accurately represent the public API.

---

## Phase 3: Code Splitting and Refactoring

**Goal:** Break down large implementation files into smaller, more focused modules.

**Tasks:**

1.  **Identify Large Files:**

    - Target files like `JsonModel.ts`, `EventSourcingDB.ts`, `DB.ts` (the refactored version), `EventQueue.ts`.

2.  **Refactor `JsonModel.ts`:**

    - Move helper functions (like `parseRow`, `_makeSetFn`, query building logic, cursor logic) into separate files within `src/JsonModel/`.
    - Potentially group methods by functionality (e.g., CRUD operations, search operations, caching logic) into separate files/modules.

3.  **Refactor `EventSourcingDB.ts`:**

    - Extract event processing steps (preprocessing, reduction, application, derivation logic) into separate functions or modules within `src/EventSourcingDB/`.
    - Move polling/waiting logic (`startPolling`, `waitForQueue`, etc.) into its own module.
    - Separate sub-event handling logic.

4.  **Refactor `DB.ts` / Worker Interaction Layer:**

    - Ensure the logic for interacting with the worker pool is well-organized. If `DB.ts` becomes complex, split it (e.g., transaction handling, statement preparation proxy).

5.  **Refactor `EventQueue.ts`:**
    - If complex, separate logic for adding events vs. retrieving/waiting for events.

**Considerations:**

- Maintain clear module boundaries and responsibilities.
- Use barrel files (`index.ts`) within directories to re-export public APIs of the split modules if needed, but avoid overly complex export chains.
- Ensure internal imports are updated correctly after moving files.

---

## Phase 4: Factory Functions API

**Goal:** Provide a simplified API for creating instances of core StratoDB components.

**Tasks:**

1.  **Design Factory Functions:**

    - Define functions like `createJsonModel(...)`, `createEventQueue(...)`, `createEventSourcingDB(...)`, `createDb(...)`.
    - Determine the necessary parameters for each factory (e.g., database file path, model definitions, queue options).
    - Decide how dependencies are managed (e.g., does `createEventSourcingDB` internally create the DB and Queue instances, or does it accept them as parameters?). Accepting instances often provides more flexibility.

2.  **Implement Factory Functions:**

    - Create a new API entry point file (e.g., `src/factories.ts` or directly in `src/index.ts`).
    - Implement the functions to encapsulate the `new Class(...)` calls.
    - Hide complex configuration options behind sensible defaults if possible.

3.  **Update Exports:**

    - Export the factory functions from the main entry point (`src/index.ts`).
    - Decide whether to continue exporting the classes directly. It might be useful for advanced users or testing, but the factories should be the recommended approach.

4.  **Update Documentation/Examples:**
    - Modify README and any usage examples to use the new factory functions.

**Considerations:**

- API design should be intuitive and cover common use cases easily.
- Balance simplicity with flexibility.
- Ensure type safety carries through the factory functions.

---
