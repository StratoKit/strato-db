/* eslint-disable require-atomic-updates */
import ESDB from '.'
import {withESDB} from '../lib/_test-helpers'

test('event error in preprocessor', () =>
	withESDB(async eSDB => {
		await expect(
			eSDB._handleEvent({type: 'error_pre'})
		).resolves.toHaveProperty(
			'error._preprocess_count',
			expect.stringContaining('pre error for you')
		)
		// All the below: don't call next phases
		// Error in apply => error: _apply
	}))

test('event error in reducer', () =>
	withESDB(async eSDB => {
		await expect(
			eSDB._handleEvent({type: 'error_reduce'})
		).resolves.toHaveProperty(
			'error._reduce_count',
			expect.stringContaining('error for you')
		)
	}))

test('event error in apply', () => {
	return withESDB(async eSDB => {
		await expect(
			eSDB._applyEvent({
				v: 1,
				type: 'foo',
				result: {
					// it will try to call map as a function
					count: {set: {map: 5}},
				},
			})
		).resolves.toHaveProperty(
			'error._apply_apply',
			expect.stringContaining('.map is not a function')
		)
	})
})

test('event error in deriver', () =>
	withESDB(async eSDB => {
		await expect(
			eSDB._handleEvent({v: 1, type: 'error_derive'})
		).resolves.toHaveProperty(
			'error._apply_derive',
			expect.stringContaining('error for you')
		)
	}))

test.only('event emitter', async () => {
	return withESDB(async eSDB => {
		let errored = 0,
			resulted = 0
		eSDB.on('result', event => {
			console.log('result', event)
			resulted++
			expect(event.error).toBeFalsy()
			expect(event.result).toBeTruthy()
		})
		eSDB.on('error', event => {
			console.log('error', event)
			errored++
			expect(event.error).toBeTruthy()
			expect(event.result).toBeUndefined()
		})
		await eSDB.dispatch('foo')
		await import('debug').then(m => m.default.enable('*'))
		await eSDB.dispatch('bar')
		eSDB.__BE_QUIET = true
		await expect(eSDB.dispatch('error_reduce')).rejects.toHaveProperty('error')
		expect(errored).toBe(1)
		expect(resulted).toBe(2)
	})
})

test('event replay', async () =>
	withESDB(async (eSDB, queue) => {
		queue.set({
			v: 1,
			type: 'TEST',
			data: {hi: true},
			result: {},
			error: {test: true},
		})

		await expect(eSDB.handledVersion(1)).resolves.not.toHaveProperty('error')
	}))

test('model fail shows name', () => {
	expect(() => new ESDB({models: {foutje: false}})).toThrow('foutje')
})

test('old reducer signature', async () => {
	// eslint-disable-next-line no-console
	const prev = console.warn
	// eslint-disable-next-line no-console
	console.warn = vi.fn()
	const eSDB = new ESDB({
		models: {
			old: {
				reducer: (model, event) =>
					event.type === 'TEST' ? {ins: [{id: 5}]} : false,
			},
		},
	})
	// eslint-disable-next-line no-console
	expect(console.warn).toHaveBeenCalled()
	await eSDB.dispatch('TEST')
	expect(await eSDB.store.old.get(5)).toBeTruthy()
	// eslint-disable-next-line no-console
	console.warn = prev
})
