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
	expect(await eSDB.db.get('PRAGMA user_version')).toHaveProperty(
		'user_version',
		5
	)
})
