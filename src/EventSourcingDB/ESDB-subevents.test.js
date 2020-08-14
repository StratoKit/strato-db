// @ts-check
import {withESDB} from '../lib/_test-helpers'

describe('subevents', () => {
	test('work', async () => {
		const models = {
			foo: {
				preprocessor: ({event, addEvent, isMainEvent}) => {
					expect(isMainEvent).not.toBeUndefined()
					if (event.type === 'hi' || event.type === 'pre')
						addEvent('pre-' + event.type)
				},
				reducer: ({event, addEvent, isMainEvent}) => {
					expect(isMainEvent).not.toBeUndefined()
					let events
					if (event.type === 'hi' || event.type === 'red') {
						addEvent('red-' + event.type)
						events = [{type: 'red-out-' + event.type}]
					}
					return {set: [{id: event.type}], events}
				},
				deriver: ({event, addEvent, isMainEvent}) => {
					expect(isMainEvent).not.toBeUndefined()
					if (event.type === 'hi' || event.type === 'der')
						addEvent('der-' + event.type)
				},
			},
		}
		return withESDB(models, async eSDB => {
			const checker = async id =>
				// this way we see the desired value in the output
				expect((await eSDB.store.foo.get(id)) || false).toHaveProperty('id', id)
			const event = await eSDB.dispatch('hi')
			expect(event.events).toHaveLength(4)
			await checker('pre-hi')
			await checker('red-hi')
			await checker('red-out-hi')
			await checker('der-hi')
			expect((await eSDB.dispatch('pre')).events).toHaveLength(1)
			await checker('pre-pre')
			await eSDB.dispatch('red')
			await checker('red-red')
			await checker('red-out-red')
			await eSDB.dispatch('der')
			await checker('der-der')
		})
	})

	test('depth first order', () => {
		const models = {
			foo: {
				reducer: ({event, addEvent}) => {
					if (event.type === 'hi') return {set: [{id: 'hi', all: ''}]}
					if (event.type === '3') addEvent('4')
				},
				deriver: async ({model, event, addEvent}) => {
					if (event.type === 'hi') {
						addEvent('1')
						addEvent('3')
					}
					if (event.type === '1') addEvent('2')
					if (event.type === '3') addEvent('5')
					const t = await model.get('hi')
					return model.set({id: 'hi', all: t.all + event.type})
				},
			},
		}
		return withESDB(models, async eSDB => {
			const spy = jest.fn(event => event.type)
			eSDB.on('result', spy)
			const event = await eSDB.dispatch('hi')
			expect(spy).toHaveBeenCalledTimes(1)
			expect(event.events).toHaveLength(2)
			expect(await eSDB.store.foo.get('hi')).toHaveProperty('all', 'hi12345')
		})
	})

	test('no infinite recursion', () => {
		const models = {
			foo: {
				deriver: async ({event, addEvent}) => {
					if (event.type === 'hi') addEvent('hi')
				},
			},
		}
		return withESDB(models, async eSDB => {
			eSDB.__BE_QUIET = true
			const doNotCall = jest.fn()
			const event = await eSDB.dispatch('hi').then(doNotCall, e => e)
			expect(doNotCall).toHaveBeenCalledTimes(0)
			expect(event).toHaveProperty(
				'error._handle',
				expect.stringMatching(/(\.hi)+:.*deep/)
			)
		})
	})

	test('replay clears subevents', () => {
		const models = {
			foo: {
				deriver: async ({event, addEvent}) => {
					if (event.type === 'hi') addEvent('ho')
				},
			},
		}
		return withESDB(models, async eSDB => {
			await eSDB.queue.set({v: 5, type: 'hi', events: [{type: 'deleteme'}]})
			const event = await eSDB.handledVersion(5)
			expect(event).toHaveProperty('events', [
				expect.objectContaining({type: 'ho'}),
			])
		})
	})
})
