import {sql} from '../DB'

export const cloneModelWithDb = (m, db) => {
	const model = Object.create(m)
	model.db = db
	model._set = model._makeSetFn()
	return model
}

export const makeMigrations = ({
	name: tableName,
	idCol,
	columns,
	keepRowId,
	migrations,
	migrationOptions,
}) => {
	const tableQuoted = sql.quoteId(tableName)
	const allMigrations = {
		...migrations,
		// We make id a real column to allow foreign keys
		0: async ({db}) => {
			const {quoted, type, autoIncrement} = columns[idCol]
			const isIntegerId = type === 'INTEGER'
			const addRowId = !isIntegerId && keepRowId
			// The NOT NULL is a SQLite bug, otherwise it allows NULL as id
			const rowIdCol = addRowId
				? `"rowId" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `
				: ''
			const keySql = addRowId
				? `${type} NOT NULL`
				: `${type} PRIMARY KEY ${
						isIntegerId && autoIncrement ? 'AUTOINCREMENT' : ''
				  } NOT NULL`

			await db.exec(
				`CREATE TABLE ${tableQuoted}(${rowIdCol}${quoted} ${keySql}, json JSON);`
			)
			if (addRowId) {
				// implement the unique constraint with our own index
				await db.exec(
					`CREATE UNIQUE INDEX ${sql.quoteId(
						`${tableName}_${idCol}`
					)} ON ${tableQuoted}(${sql.quoteId(idCol)})`
				)
			}
		},
	}
	for (const [name, col] of Object.entries(columns)) {
		// We already added these, or it's an alias
		if (name === idCol || name === 'json' || name !== col.name) continue
		const expr = col.sql.replace('tbl.', '')
		// Make sure real columns are created before indexes on expressions
		allMigrations[`${col.real ? 0 : 1}_${name}`] = ({db}) =>
			db.exec(
				`${
					col.type
						? `ALTER TABLE ${tableQuoted} ADD COLUMN ${col.quoted} ${col.type};`
						: ''
				}${
					col.index
						? `CREATE ${
								col.unique ? 'UNIQUE ' : ''
						  }INDEX IF NOT EXISTS ${sql.quoteId(
								`${tableName}_${name}`
						  )} ON ${tableQuoted}(${expr}) ${
								col.ignoreNull ? `WHERE ${expr} IS NOT NULL` : ''
						  };`
						: ''
				}`
			)
	}
	// Wrap the migration functions to provide their arguments
	const wrappedMigrations = {}
	const wrap = fn =>
		fn &&
		(writeableDb => {
			if (!writeableDb.store.__madeWriteable) {
				const {store} = writeableDb
				const newStore = {__madeWriteable: true}
				// Create a patched version of all models that uses the migration db
				for (const m of Object.values(store)) {
					if (typeof m !== 'object') continue
					newStore[m.name] = cloneModelWithDb(m, writeableDb)
				}
				writeableDb.store = newStore
			}
			const model = writeableDb.store[tableName]
			return fn({...migrationOptions, db: writeableDb, model})
		})
	const wrapMigration = migration => wrap(migration.up || migration)

	for (const k of Object.keys(allMigrations)) {
		const m = allMigrations[k]
		if (m) wrappedMigrations[k] = wrapMigration(m)
	}
	return wrappedMigrations
}
