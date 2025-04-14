# Lib Module (`src/lib`)

This directory contains miscellaneous utility functions used across the codebase.

## Core Components

### `settleAll.js`

- **Purpose:** Provides a function likely analogous to `Promise.allSettled`, allowing multiple promises to be awaited, capturing both fulfilled values and rejection reasons without short-circuiting on the first rejection.
- **Usage:** Useful when you need to process a batch of independent asynchronous operations and handle their individual outcomes.

### `slugify.js`

- **Purpose:** Converts a string into a URL-friendly "slug" format.
- **Key Features:** Likely removes special characters, converts to lowercase, and replaces spaces with hyphens.
- **Usage:** Generating clean identifiers for URLs or filenames.

### `warning.js`

- **Purpose:** Handles the display of warnings or deprecation notices, potentially only in development environments.
- **Key Features:** Exports `DEV` (boolean indicating development mode) and `deprecated` (function to log deprecation warnings).
- **Usage:** Providing feedback to developers about outdated APIs or potential issues without cluttering production logs.

### `_test-helpers.js`

- **Purpose:** Contains helper functions specifically designed for use within the project's test suite (`*.test.js` files).
- **Usage:** Reducing boilerplate and simplifying common testing patterns.

## Structure

```
src/
└── lib/
    ├── settleAll.js
    ├── slugify.js
    ├── slugify.test.js
    ├── warning.js
    └── _test-helpers.js
```
