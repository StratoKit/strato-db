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
			const spy = vi.fn(event => event.type)
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
			const doNotCall = vi.fn()
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

describe('transact', () => {
	test('gets called', async () => {
		const models = {
			foo: {transact: vi.fn()},
		}
		return withESDB(models, async eSDB => {
			await eSDB.dispatch('hi')
			expect(models.foo.transact).toHaveBeenCalledTimes(1)
			expect(models.foo.transact).toHaveBeenCalledWith(
				expect.objectContaining({
					event: expect.any(Object),
					model: expect.any(Object),
					dispatch: expect.any(Function),
					store: expect.any(Object),
					isMainEvent: true,
				})
			)
		})
	})

	test('sync error stops transaction', async () => {
		const models = {
			foo: {
				transact: ({event: {type}}) => {
					if (type === 'sync') throw 'oops sync'
				},
			},
		}
		return withESDB(models, async eSDB => {
			eSDB.__BE_QUIET = true
			await expect(eSDB.dispatch('sync')).rejects.toHaveProperty('error', {
				_transact_foo: 'oops sync',
			})
		})
	})

	test('rejection stops transaction', async () => {
		const models = {
			foo: {
				transact: ({event: {type}}) => {
					if (type === 'reject') return Promise.reject('oops reject')
				},
			},
		}
		return withESDB(models, async eSDB => {
			eSDB.__BE_QUIET = true
			await expect(eSDB.dispatch('reject')).rejects.toHaveProperty('error', {
				_transact_foo: 'oops reject',
			})
		})
	})

	test('throws when dispatching outside transact', async () => {
		const models = {
			foo: {
				reducer: ({model}) => model.set({id: 'hi'}),
			},
		}
		return withESDB(models, async eSDB => {
			eSDB.__BE_QUIET = true
			await expect(eSDB.dispatch('hi')).rejects.toEqual(
				expect.objectContaining({
					error: expect.objectContaining({
						_reduce_foo: expect.stringContaining('only allowed in transact'),
					}),
				})
			)
		})
	})

	test('does not throw when dispatching outside processing', async () => {
		let resolve1, resolve2
		let ranReducer = new Promise(r => (resolve1 = r))
		const models = {
			foo: {
				reducer: async ({event: {type}}) => {
					if (type === 'hi')
						await new Promise(r => {
							resolve2 = r
							resolve1()
						})
				},
			},
		}
		return withESDB(models, async eSDB => {
			eSDB.__BE_QUIET = true
			eSDB.dispatch('hi')
			await ranReducer
			setTimeout(resolve2)
			await expect(eSDB.store.foo.set('ho')).resolves.toBeDefined()
		})
	})

	test('can dispatch', async () => {
		const models = {
			foo: {
				transact: async ({event, dispatch}) => {
					if (event.type !== 'hi') return
					await expect(dispatch('sub-hi')).resolves.toEqual(
						expect.objectContaining({
							type: 'sub-hi',
							result: expect.any(Object),
						})
					)
				},
			},
		}
		return withESDB(models, async eSDB => {
			expect(await eSDB.dispatch('hi')).toHaveProperty(
				'events.0.type',
				'sub-hi'
			)
		})
	})

	test('can use dispatch via model', async () => {
		const models = {
			foo: {
				transact: async ({event, model}) => {
					if (event.type !== 'hi') return
					expect(await model.set({id: 'hi'})).toEqual({id: 'hi'})
				},
			},
		}
		return withESDB(models, async eSDB => {
			expect(await eSDB.dispatch('hi')).toHaveProperty(
				'events.0.type',
				'es/foo'
			)
		})
	})

	test('can transact in sub-event', async () => {
		const models = {
			foo: {
				transact: async ({event, dispatch}) => {
					if (event.type === 'hi')
						await expect(dispatch('sub-hi')).resolves.toEqual(
							expect.objectContaining({
								type: 'sub-hi',
								result: expect.any(Object),
							})
						)
					if (event.type === 'sub-hi')
						await expect(dispatch('sub-sub-hi')).resolves.toEqual(
							expect.objectContaining({
								type: 'sub-sub-hi',
								result: expect.any(Object),
							})
						)
				},
			},
		}
		return withESDB(models, async eSDB => {
			expect(await eSDB.dispatch('hi')).toHaveProperty(
				'events.0.events.0.type',
				'sub-sub-hi'
			)
		})
	})

	test('handles sub-events in order', async () => {
		let lastSeen = 0
		const models = {
			foo: {
				reducer: ({event: {type, data}}) => {
					if (type === 'sub') {
						expect(lastSeen).toBeLessThan(data)
						lastSeen = data
					}
				},
				transact: async ({event, dispatch}) => {
					if (event.type === 'hi') {
						for (let i = 1; i < 9; i++) dispatch('sub', i)
						await dispatch('sub', 9)
					}
				},
			},
		}
		return withESDB(models, async eSDB => {
			await eSDB.dispatch('hi')
		})
	})

	test('gets subevent from dispatch', async () => {
		const models = {
			foo: {
				transact: async ({event, dispatch}) => {
					if (event.type !== 'hi') return
					const sub = await dispatch('sub', 9)
					expect(sub).toHaveProperty('type', 'sub')
					expect(await dispatch('sub2', 10)).toHaveProperty('data', 10)
					expect(await dispatch('sub3', 11)).toHaveProperty('type', 'sub3')
				},
			},
		}
		return withESDB(models, async eSDB => {
			await eSDB.dispatch('hi')
		})
	})
})
