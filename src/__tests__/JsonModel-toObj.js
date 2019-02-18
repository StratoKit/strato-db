
import {getModel} from './_helpers'

test('toObj nothing', () => {
	const m = getModel()
	expect(m.toObj()).toBeFalsy()
})

test('toObj single', () => {
	const m = getModel()
	expect(m.toObj({_j: '{"hi":5}', _i: 2})).toEqual({hi: 5, id: 2})
})

test('toObj derived', () => {
	const m = getModel({
		columns: {ohai: {real: true, get: true}, beep: {}},
	})
	expect(m.toObj({_j: '{"hi":5}', _0: 8, hi: 3, nohai: 4, _i: 0})).toEqual({
		hi: 5,
		ohai: 8,
		id: 0,
	})
})

test('toObj array', () => {
	const m = getModel()
	expect(m.toObj([{_j: '{"hi":5}', _i: 0}, {_j: '{"ho":6}', _i: 1}])).toEqual([
		{hi: 5, id: 0},
		{ho: 6, id: 1},
	])
})

test('enforce string type', async () => {
	const m = getModel({
		columns: {
			f: {type: 'TEXT'},
			g: {real: true},
		},
	})
	await m.set({id: 2, f: 5, g: 6})
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

test('parse validity', async () => {
	expect(() =>
		getModel({columns: {f: {value: o => o.f, parse: v => `_${v}`}}})
	).toThrow()
})

test('parse function', async () => {
	const m = getModel({
		columns: {
			f: {real: true, parse: v => `_${v}`},
			g: {get: true, parse: v => `_${v}`},
		},
	})
	const o = await m.set({f: 'hi', g: 'there'})
	expect(o.f).toBe('_hi')
	// On the set return, only real columns are gotten
	expect(o.g).toBe('there')
	const p = await m.get(o.id)
	expect(p.f).toBe('_hi')
	expect(p.g).toBe('_there')
})
