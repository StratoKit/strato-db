import expect from 'expect';
import {getModel} from './_helpers'

test('toObj nothing', () => {
	const m = getModel()
	expect(m.toObj()).toBeFalsy()
})

test('toObj single', () => {
	const m = getModel()
	expect(m.toObj({_1: '{"hi":5}', _0: 2})).toEqual({hi: 5, id: 2})
})

test('toObj derived', () => {
	const m = getModel({
		columns: {ohai: {value: o => o.ohai, get: true}, beep: {jsonPath: 'beep'}},
	})
	expect(m.toObj({_3: '{"hi":5}', _0: 8, hi: 3, nohai: 4, _2: 0})).toEqual({
		hi: 5,
		ohai: 8,
		id: 0,
	})
})

test('toObj array', () => {
	const m = getModel()
	expect(m.toObj([{_1: '{"hi":5}', _0: 0}, {_1: '{"ho":6}', _0: 1}])).toEqual([
		{hi: 5, id: 0},
		{ho: 6, id: 1},
	])
})

test('enforce string type', async () => {
	const m = getModel({
		columns: {
			f: {type: 'TEXT', value: () => 5, get: true},
			g: {value: () => 6, get: true},
		},
	})
	await m.set({id: 2})
	const o = await m.searchOne()
	expect(o.id).toBe('2')
	expect(o.f).toBe('5')
	expect(o.g).toBe(6)
})

test('long number string id', async () => {
	const m = getModel()
	const id = '234234239874972349872342'
	await m.set({id})
	const o = await m.searchOne()
	expect(o.id).toBe(id)
})
