import JsonModel from './JsonModel'

const storeEvent = (event, events, path) => {
	let j, index
	for (j = 0; j < path.length - 1; j++) {
		index = path[j]
		const parent = events[index]
		if (!parent) throw new Error('out of order', events, event, path)
		parent.events ||= []
		events = parent.events
	}
	index = path[j]
	events[index] = event
}

class EventResults extends JsonModel {
	constructor({name = '{esdb} results', withViews, ...rest}) {
		const columns = {
			version: {type: 'TEXT'},
			// Note, not unique! Just a copy of the event.v that's in version
			v: {
				type: 'INTEGER',
				index: 'ALL',
				value: o => o.version.split('.')[0],
			},
			type: {type: 'TEXT'},
			data: {type: 'JSON'},
			result: {type: 'JSON', alwaysObject: true},
			ts: {type: 'INTEGER'},
			error: {type: 'JSON'},
			size: {type: 'INTEGER', default: 0, get: false},
		}
		if (rest.columns)
			for (const [key, value] of Object.entries(rest.columns)) {
				if (!value) continue
				if (columns[key]) throw new TypeError(`Cannot override column ${key}`)
				columns[key] = value
			}
		super({
			...rest,
			name,
			keepRowId: true,
			idCol: 'version',
			columns,
			migrations: {
				...rest.migrations,
				addTypeSizeIndex: ({db}) =>
					db.exec(
						`CREATE INDEX IF NOT EXISTS "${this.name} type,size" on "${this.name}"(type, size)`
					),
				'20190521_addViews': withViews
					? async ({db}) => {
							// The size WHERE clause is to prevent recursive triggers
							await db.exec(`
								DROP TRIGGER IF EXISTS "${this.name} size insert";
								DROP TRIGGER IF EXISTS "${this.name} size update";
								CREATE TRIGGER "${this.name} size insert" AFTER INSERT ON "${this.name}" BEGIN
									UPDATE "${this.name}" SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE rowId=new.rowId;
								END;
								CREATE TRIGGER "${this.name} size update" AFTER UPDATE ON "${this.name}" BEGIN
									UPDATE "${this.name}" SET
										size=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0)
									WHERE rowId=new.rowId AND size!=ifNull(length(new.json),0)+ifNull(length(new.data),0)+ifNull(length(new.result),0);
								END;
								DROP VIEW IF EXISTS "{sdb} result types";
								CREATE VIEW "{sdb} result types" AS
									SELECT
										type,
										COUNT(*) AS count,
										SUM(size)/1024/1024 AS MB
									FROM "${this.name}" GROUP BY type ORDER BY count DESC;
							`)
							// Recalculate size
							await db.exec(`UPDATE "${this.name}" SET size=0`)
					  }
					: null,
			},
		})
	}

	async getEvent(v) {
		const results = await this.searchAll({v})
		const event = results[0]
		event.events = []
		for (let i = 1; i < results.length; i++) {
			const e = results[i]
			const vPath = e.version.split('.').slice(1)
			storeEvent(e, event.events, vPath)
		}
		return event
	}
}

export default EventResults
