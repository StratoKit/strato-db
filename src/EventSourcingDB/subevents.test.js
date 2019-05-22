import {withESDB} from '../lib/_test-helpers'

test('work', () => {
	const models = {
		foo: {
			preprocessor: ({event, dispatch}) => {
				if (event.type === 'hi') dispatch('hello')
			},
			reducer: (model, event) => {
				return {
					set: [{id: event.type}],
					events: event.type === 'hi' && [{type: 'everybody'}],
				}
			},
			deriver: ({event, dispatch}) => {
				if (event.type === 'hi') dispatch('there')
			},
		},
	}
	return withESDB(async eSDB => {
		const event = await eSDB.dispatch('hi')
		expect(event.events).toHaveLength(3)
		expect(await eSDB.store.foo.exists({id: 'hi'})).toBeTruthy()
		expect(await eSDB.store.foo.exists({id: 'hello'})).toBeTruthy()
		expect(await eSDB.store.foo.exists({id: 'everybody'})).toBeTruthy()
		expect(await eSDB.store.foo.exists({id: 'there'})).toBeTruthy()
	}, models)
})

test('depth first order', () => {
	const models = {
		foo: {
			reducer: (model, event) => {
				if (event.type === 'hi') return {set: [{id: 'hi', all: ''}]}
				if (event.type === '3') return {events: [{type: '4'}]}
			},
			deriver: async ({model, event, dispatch}) => {
				if (event.type === 'hi') {
					dispatch('1')
					dispatch('3')
				}
				if (event.type === '1') dispatch('2')
				if (event.type === '3') dispatch('5')
				const t = await model.get('hi')
				return model.set({id: 'hi', all: t.all + event.type})
			},
		},
	}
	return withESDB(async eSDB => {
		const spy = jest.fn(event => event.type)
		eSDB.on('result', spy)
		const event = await eSDB.dispatch('hi')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(event.events).toHaveLength(2)
		expect(await eSDB.store.foo.get('hi')).toHaveProperty('all', 'hi12345')
	}, models)
})

test('no infinite recursion', () => {
	const models = {
		foo: {
			deriver: async ({event, dispatch}) => {
				if (event.type === 'hi') dispatch('hi')
			},
		},
	}
	return withESDB(async eSDB => {
		eSDB.__BE_QUIET = true
		const doNotCall = jest.fn()
		const event = await eSDB._dispatchWithError('hi').then(doNotCall, e => e)
		expect(doNotCall).toHaveBeenCalledTimes(0)
		expect(event).toHaveProperty('error._handle', 'subevent 0 failed')
		expect(event).toHaveProperty(
			'events.0.events.0.events.0.events.0.error._handle',
			'subevent 0 failed'
		)
	}, models)
})
