import test from 'ava'
import {getModel} from './_helpers'

test('toObj nothing', t => {
	const m = getModel()
	t.falsy(m.toObj())
})

test('toObj single', t => {
	const m = getModel()
	t.deepEqual(m.toObj({_1: '{"hi":5}', _0: 2}), {hi: 5, id: 2})
})

test('toObj derived', t => {
	const m = getModel({
		columns: {ohai: {value: o => o.ohai, get: true}, beep: {jsonPath: 'beep'}},
	})
	t.deepEqual(m.toObj({_3: '{"hi":5}', _0: 8, hi: 3, nohai: 4, _2: 0}), {
		hi: 5,
		ohai: 8,
		id: 0,
	})
})

test('toObj array', t => {
	const m = getModel()
	t.deepEqual(m.toObj([{_1: '{"hi":5}', _0: 0}, {_1: '{"ho":6}', _0: 1}]), [
		{hi: 5, id: 0},
		{ho: 6, id: 1},
	])
})

test('enforce string type', async t => {
	const m = getModel({
		columns: {
			f: {type: 'TEXT', value: () => 5, get: true},
			g: {value: () => 6, get: true},
		},
	})
	await m.set({id: 2})
	const o = await m.searchOne()
	t.is(o.id, '2')
	t.is(o.f, '5')
	t.is(o.g, 6)
})

test('long number string id', async t => {
	const m = getModel()
	const id = '234234239874972349872342'
	await m.set({id})
	const o = await m.searchOne()
	t.is(o.id, id)
})
