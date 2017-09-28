import test from 'ava'
import {getModel} from './_helpers'

test('searchOne', async t => {
	const m = getModel()
	const obj = {id: 'foobar', fluffy: true}
	await m.set(obj)
	const saved = await m.searchOne({id: obj.id})
	t.deepEqual(saved, obj)
})

test('search[One] attrs=null', async t => {
	const m = getModel()
	await t.notThrows(m.searchOne(null))
	await t.notThrows(m.search(null))
	await t.notThrows(m.searchOne(undefined))
	await t.notThrows(m.search(undefined))
	await m.set({t: 5})
	const all = await m.search(null)
	t.is(all.items[0].t, 5)
})

test('search cursor', async t => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, c: {jsonPath: 'c'}, d: {jsonPath: 'd'}},
	})
	const str = 'aabbccddeeff'
	await Promise.all(
		'ddaabbcceeff'.split('').map((c, i) => m.set({id: i, c, d: str.charAt(i)}))
	)
	const q = {
		where: {"json_extract(json, '$.c')>?": ['b']},
		sort: {c: -1, d: 1},
		limit: 3,
	}
	const o = await m.search(null, q)
	t.deepEqual(o, {
		items: [
			{id: 10, c: 'f', d: 'f'},
			{id: 11, c: 'f', d: 'f'},
			{id: 8, c: 'e', d: 'e'},
		],
		cursor: '!e~e~8',
	})
	const n = await m.search(null, {...q, cursor: o.cursor})
	t.deepEqual(n, {
		items: [
			{id: 9, c: 'e', d: 'e'},
			{id: 0, c: 'd', d: 'a'},
			{id: 1, c: 'd', d: 'a'},
		],
		cursor: '!d~a~1',
	})
	const l = await m.search(null, {...q, cursor: n.cursor})
	t.deepEqual(l, {
		items: [{id: 6, c: 'c', d: 'd'}, {id: 7, c: 'c', d: 'd'}],
		cursor: undefined,
	})
})

test('search itemsOnly', async t => {
	const m = getModel()
	const obj = await m.set({fluffy: true})
	t.deepEqual(await m.search(null, {itemsOnly: true}), [obj])
})

test('exists', async t => {
	const m = getModel({columns: {hi: {jsonPath: 'hi'}}})
	t.false(await m.exists())
	await m.set({hi: true})
	t.true(await m.exists())
	t.true(await m.exists({hi: true}))
	t.false(await m.exists({hi: false}))
})
