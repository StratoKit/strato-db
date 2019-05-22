import {JsonModel} from '..'
import ESDB from '.'

test('metadata migration', async () => {
	class M extends JsonModel {
		constructor(props) {
			super({
				...props,
				migrations: {
					...props.migrations,
					1: async ({model}) => model.set({id: 'version', v: 5}),
				},
			})
		}

		static reducer() {}
	}
	const eSDB = new ESDB({
		models: {metadata: {Model: M}},
	})
	// Version should be moved to user_version
	expect(await eSDB.db.get('PRAGMA user_version')).toHaveProperty(
		'user_version',
		5
	)
	// metadata table should be gone
	expect(
		await eSDB.db.get('SELECT * FROM sqlite_master WHERE name="metadata"')
	).toBeFalsy()
})

test('metadata migration with existing data', async () => {
	class M extends JsonModel {
		constructor(props) {
			super({
				...props,
				migrations: {
					...props.migrations,
					1: async ({model}) => {
						await model.set({id: 'version', v: 5})
						await model.set({id: 'hi'})
					},
				},
			})
		}

		static reducer() {}
	}
	const eSDB = new ESDB({
		models: {metadata: {Model: M}},
	})
	// Version should be moved to user_version
	expect(await eSDB.db.get('PRAGMA user_version')).toHaveProperty(
		'user_version',
		5
	)
	// metadata table should still be there
	expect(
		await eSDB.db.get('SELECT * FROM sqlite_master WHERE name="metadata"')
	).toBeTruthy()
	// but version should be gone
	expect(
		await eSDB.db.get('SELECT * FROM metadata WHERE id="version"')
	).toBeFalsy()
})
