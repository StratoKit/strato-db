import {getModel} from '../lib/_test-helpers'

test('searchOne', async () => {
	const m = getModel()
	const obj = {id: 'foobar', fluffy: true}
	await m.set(obj)
	const saved = await m.searchOne({id: obj.id})
	expect(saved).toEqual(obj)
})

test('search[One] attrs=null', async () => {
	const m = getModel()
	await expect(m.searchOne(null)).resolves.not.toThrow()
	await expect(m.search(null)).resolves.not.toThrow()
	await expect(m.searchOne(undefined)).resolves.not.toThrow()
	await expect(m.search(undefined)).resolves.not.toThrow()
	await m.set({t: 5})
	const all = await m.search(null)
	expect(all.items[0].t).toBe(5)
})

test('cursor id-only', () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			c: {type: 'TEXT'},
			d: {},
			e: {where: '?'},
		},
	})
	expect(m.makeSelect({limit: 5})).toEqual([
		'SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl ORDER BY _i LIMIT 5',
		[],
		['_i'],
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl )',
		[],
	])
	expect(m.makeSelect({limit: 5, cursor: '!3'})).toEqual([
		'SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl WHERE(_i>?) ORDER BY _i LIMIT 5',
		[3],
		['_i'],
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl )',
		[],
	])
})

test('search cursor', async () => {
	const m = getModel({
		columns: {id: {type: 'INTEGER'}, c: {}, d: {}},
	})
	const str = 'aabbccddeeff'
	await Promise.all(
		[...'ddaabbcceeff'].map((c, i) => m.set({id: i, c, d: str.charAt(i)}))
	)
	const q = {
		where: {"json_extract(json, '$.c')>?": ['b']},
		sort: {c: -1, d: 1},
		limit: 3,
	}
	const o = await m.search(null, q)
	expect(o).toEqual({
		items: [
			{id: 10, c: 'f', d: 'f'},
			{id: 11, c: 'f', d: 'f'},
			{id: 8, c: 'e', d: 'e'},
		],
		cursor: '!e~e~8',
		total: 8,
	})
	const n = await m.search(null, {...q, cursor: o.cursor, noTotal: true})
	expect(n).toEqual({
		items: [
			{id: 9, c: 'e', d: 'e'},
			{id: 0, c: 'd', d: 'a'},
			{id: 1, c: 'd', d: 'a'},
		],
		cursor: '!d~a~1',
	})
	const l = await m.search(null, {...q, cursor: n.cursor})
	expect(l).toEqual({
		items: [
			{id: 6, c: 'c', d: 'd'},
			{id: 7, c: 'c', d: 'd'},
		],
		cursor: undefined,
		total: 8,
	})
})

test('search itemsOnly', async () => {
	const m = getModel()
	const obj = await m.set({fluffy: true})
	expect(await m.search(null, {itemsOnly: true})).toEqual([obj])
})

test('searchAll', async () => {
	const m = getModel()
	const obj = await m.set({fluffy: true})
	expect(await m.searchAll()).toEqual([obj])
})

test('exists', async () => {
	const m = getModel({columns: {hi: {}}})
	expect(await m.exists()).toBe(false)
	await m.set({hi: true})
	expect(await m.exists()).toBe(true)
	expect(await m.exists({hi: true})).toBe(true)
	expect(await m.exists({hi: false})).toBe(false)
})

test('exists id', async () => {
	const m = getModel({columns: {hi: {}}})
	await m.set({id: 1}) // make sure we have rows so empty exists returns true
	expect(await m.exists(55)).toBe(false)
	await m.set({id: 55})
	expect(await m.exists(55)).toBe(true)
	expect(await m.exists('foo')).toBe(false)
	await m.set({id: 'foo'})
	expect(await m.exists('foo')).toBe(true)
})
