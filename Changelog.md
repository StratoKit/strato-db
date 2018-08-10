# Changelog

## 1.3.0

- ESModel: add metadata to event data on index 3

## 1.2.0

- JsonModel: `required` flag on column makes sure the result of value() is non-null and sets allowNull to false for proper indexing

## 1.1.0

- Directly depend on mapbox/sqlite3 by copying the relevant code from kriasoft/sqlite
- Remove Bluebird dependency
