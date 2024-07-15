import PropTypes from 'prop-types'

/**
 * @type {Object}
 *
 * @typedef ColumnDef
 * @property {boolean} [real=!!type] - Is this a real table column. Default is
 *   `!!type`
 * @property {string} [type]
 *
 *   - Sql column type as accepted by {@link DB}
 *
 * @property {string} [path]
 *
 *   - Path to the value in the object.
 *
 * @property {boolean} [autoIncrement]
 *
 *   - INTEGER id column only: apply AUTOINCREMENT on the column.
 *
 * @property {string} [alias]
 *
 *   - The alias to use in SELECT statements.
 *
 * @property {boolean} [get=true] - Should the column be included in search
 *   results. Default is `true`
 * @property {function} [parse]
 *
 *   - Process the value after getting from DB.
 *
 * @property {function} [stringify]
 *
 *   - Process the value before putting into DB.
 *
 * @property {boolean} [alwaysObject]
 *
 *   - The value is an object and must always be there. If this is a real column, a
 *       NULL column value will be replaced by `{}` and vice versa.
 *
 * @property {function} [value]
 *
 *   - Function getting object and returning the value for the column; this creates
 *       a real column. Right now the column value is not regenerated for
 *       existing rows.
 *
 * @property {function} [slugValue]
 *
 *   - Same as value, but the result is used to generate a unique slug.
 *
 * @property {string} [sql]
 *
 *   - Any sql expression to use in SELECT statements.
 *
 * @property {any} [default]
 *
 *   - If the value is nullish, this will be stored instead.
 *
 * @property {boolean} [required]
 *
 *   - Throw when trying to store a NULL.
 *
 * @property {boolean} [falsyBool]
 *
 *   - Store/retrieve this boolean value as either `true` or absent from the object.
 *
 * @property {boolean} [index]
 *
 *   - Should it be indexed? If `unique` is false, NULLs are never indexed.
 *
 * @property {boolean} [ignoreNull=!unique] - Are null values ignored in the
 *   index?. Default is `!unique`
 * @property {boolean} [unique]
 *
 *   - Should the index enforce uniqueness?
 *
 * @property {function} [whereVal]
 *
 *   - A function receiving `origVals` and returning the `vals` given to `where`. It
 *       should return falsy or an array of values.
 *
 * @property {string | function} [where]
 *
 *   - The where clause for querying, or a function returning one given `(vals,
 *       origVals)`
 *
 * @property {boolean} [isArray]
 *
 *   - This column contains an array of values.
 *
 * @property {boolean} [in]
 *
 *   - To query, this column value must match one of the given array items.
 *
 * @property {boolean} [inAll]
 *
 *   - [isArray only] to query, this column value must match all of the given array
 *       items.
 *
 * @property {boolean} [textSearch]
 *
 *   - Perform searches as substring search with LIKE.
 *
 * @property {boolean} [isAnyOfArray]
 *
 *   - Alias for isArray+inAll.
 */

export const columnPropType =
	process.env.NODE_ENV === 'production'
		? null
		: PropTypes.exact({
				// === sql column ===
				real: PropTypes.bool,
				// column type if real column
				type: PropTypes.oneOf([
					'TEXT',
					'NUMERIC',
					'INTEGER',
					'REAL',
					'BLOB',
					'JSON',
				]),
				path: PropTypes.string,
				autoIncrement: PropTypes.bool,
				alias: PropTypes.string,
				get: PropTypes.bool,
				parse: PropTypes.func,
				stringify: PropTypes.func,
				alwaysObject: PropTypes.bool,
				// === value related ===
				slugValue: PropTypes.func,
				sql: PropTypes.string,
				value: PropTypes.func,
				default: PropTypes.any,
				required: PropTypes.bool,
				falsyBool: PropTypes.bool,
				// === index ===
				// create index for this column
				index: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
				ignoreNull: PropTypes.bool,
				unique: PropTypes.bool,
				// === queries ===
				where: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
				whereVal: PropTypes.func,
				// === query helpers ===
				in: PropTypes.bool,
				inAll: PropTypes.bool,
				isAnyOfArray: PropTypes.bool,
				isArray: PropTypes.bool,
				textSearch: PropTypes.bool,
			})

export const verifyColumn = (name, column) => {
	if (process.env.NODE_ENV !== 'production') {
		/* eslint-disable no-console */
		const prevError = console.error
		console.error = message => {
			console.error = prevError
			throw new Error(message)
		}
		PropTypes.checkPropTypes(
			{column: columnPropType},
			{column},
			`column`,
			'JsonModel'
		)
		console.error = prevError
		/* eslint-enable no-console */
	}
}

/**
 * @type {Object}
 *
 * @typedef JMOptions
 * @property {DB} db - A DB instance, normally passed by DB.
 * @property {string} name - The table name.
 * @property {Object} [migrations] - An object with migration functions. They
 *   are ran in alphabetical order.
 * @property {Object} [migrationOptions] - Free-form data passed to the
 *   migration functions.
 * @property {Object} [columns] - The column definitions as {@link ColumnDef}
 *   objects. Each value must be a columndef or a function returning a
 *   columndef.
 * @property {function} [ItemClass] - An object class to use for results, must
 *   be able to handle `Object.assign(item, result)`
 * @property {string} [idCol='id'] - The key of the ID column. Default is `'id'`
 * @property {boolean} [keepRowId] - Preserve row id after vacuum.
 */
const jmPropTypes =
	process.env.NODE_ENV === 'production'
		? null
		: {
				options: PropTypes.exact({
					db: PropTypes.object.isRequired,
					name: PropTypes.string.isRequired,
					migrations: PropTypes.objectOf(
						PropTypes.oneOfType([
							PropTypes.oneOf([false]),
							PropTypes.func,
							PropTypes.exact({up: PropTypes.func, down: PropTypes.func}),
						])
					),
					migrationOptions: PropTypes.object,
					columns: PropTypes.objectOf(
						PropTypes.oneOfType([PropTypes.func, columnPropType])
					),
					ItemClass: PropTypes.func,
					idCol: PropTypes.string,
					keepRowId: PropTypes.bool,
					// Harmless props passed by ESDB
					dispatch: PropTypes.any,
					emitter: PropTypes.any,
				}),
			}

export const verifyOptions = options => {
	if (process.env.NODE_ENV !== 'production') {
		/* eslint-disable no-console */
		const prevError = console.error
		console.error = message => {
			console.error = prevError
			throw new Error(message)
		}
		PropTypes.checkPropTypes(jmPropTypes, {options}, 'options', 'JsonModel')
		console.error = prevError
		/* eslint-enable no-console */
	}
}
