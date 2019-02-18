import {sql} from '../DB'

export const cloneModelWithDb = (m, db) => {
	const model = Object.create(m)
	model.db = db
	model._set = model._makeSetFn()
	return model
}

export const makeMigrations = ({
	db,
	name: tableName,
	idCol,
	columns,
	migrations,
	migrationOptions,
}) => {
	const tableQuoted = sql.quoteId(tableName)
	const allMigrations = {
		...migrations,
		// We make id a real column to allow foreign keys
		0: ({db}) => {
			const {quoted, type, autoIncrement} = columns[idCol]
			const keySql = `${type} PRIMARY KEY ${
				autoIncrement ? 'AUTOINCREMENT' : ''
			}`
			return db.exec(
				`CREATE TABLE ${tableQuoted}(${quoted} ${keySql}, json JSON);`
			)
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
	const wrapMigration = migration => {
		const wrap = fn =>
			fn &&
			(writeableDb => {
				if (!writeableDb.models[tableName]) {
					// Create a patched version of all models that uses the migration db
					Object.values(db.models).forEach(m => {
						writeableDb.models[m.name] = cloneModelWithDb(m, writeableDb)
					})
				}
				const model = writeableDb.models[tableName]
				return fn({...migrationOptions, db: writeableDb, model})
			})
		return wrap(migration.up || migration)
	}
	Object.keys(allMigrations).forEach(k => {
		const m = allMigrations[k]
		if (m) wrappedMigrations[k] = wrapMigration(m)
	})
	return wrappedMigrations
}
