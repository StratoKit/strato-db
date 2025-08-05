import {getModel} from '../lib/_test-helpers'

test('searchOne', async () => {
	const m = getModel({columns: {upperId: {sql: 'upper(id)'}}})
	const obj = {id: 'foobar', fluffy: true}
	await m.set(obj)
	const saved = await m.searchOne({id: obj.id})
	expect(saved).toEqual(obj)
	// check if `options` argument is properly passed
	const idOnly = await m.searchOne({id: obj.id}, {cols: ['upperId']})
	expect(idOnly).toEqual({upperId: obj.id.toUpperCase()})
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

test('makeSelect with cursor', () => {
	const m = getModel({
		columns: {
			id: {type: 'INTEGER'},
			c: {type: 'TEXT'},
			d: {},
		},
	})
	expect(m.makeSelect({limit: 5})).toEqual([
		'SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl ORDER BY _i LIMIT 5',
		[],
		['_i'],
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl )',
		[],
		false,
	])
	expect(m.makeSelect({limit: 5, cursor: '!3'})).toEqual([
		'SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl WHERE(_i>?) ORDER BY _i LIMIT 5',
		[3],
		['_i'],
		'SELECT COUNT(*) as t from ( SELECT tbl."id" AS _i,tbl."c" AS _0,tbl."json" AS _j FROM "testing" tbl )',
		[],
		false,
	])
})

describe('search cursor', () => {
	let m, q, sampleSortedTotal, sampleSortedItems
	beforeAll(async () => {
		m = getModel({
			columns: {
				id: {type: 'INTEGER'},
				s1: {},
				s2: {},
				x1: {},
				x2: {falsyBool: true},
			},
		})
		const sampleStr = 'aaabbccddffeee'
		await Promise.all(
			[...'DCACAEDFCAEBEF'].map((s1, i) =>
				m.set({
					id: i + 1,
					s1,
					s2: sampleStr[i],
					x1: i % 2 === 0 ? 0 : 1,
					x2: i % 2 === 0 ? 0 : 1,
				})
			)
		)

		q = {
			where: {"json_extract(json, '$.s1')>?": ['B']},
			sort: {
				s1: -1,
				s2: 1,
				// id: 100_000,
			},
			limit: undefined,
		}

		const resNoLimit = await m.search(null, q)
		sampleSortedTotal = resNoLimit.total
		sampleSortedItems = resNoLimit.items
	})

	test('search with where, sort, no limit + reverse', async () => {
		const resNoLimit = await m.search(null, q)
		expect(resNoLimit).toEqual({
			cursor: undefined,
			items: [
				{id: 8, s1: 'F', s2: 'd', x1: 1, x2: true},
				{id: 14, s1: 'F', s2: 'e', x1: 1, x2: true},
				{id: 6, s1: 'E', s2: 'c', x1: 1, x2: true},
				{id: 13, s1: 'E', s2: 'e', x1: 0},
				{id: 11, s1: 'E', s2: 'f', x1: 0},
				{id: 1, s1: 'D', s2: 'a', x1: 0},
				{id: 7, s1: 'D', s2: 'c', x1: 0},
				{id: 2, s1: 'C', s2: 'a', x1: 1, x2: true},
				{id: 4, s1: 'C', s2: 'b', x1: 1, x2: true},
				{id: 9, s1: 'C', s2: 'd', x1: 0},
			],
			prevCursor: undefined,
			total: 10,
		})

		const resReverseSortNoLimit = await m.search(null, {
			...q,
			sort: {
				s1: 1,
				s2: -1,
				// id: -100_000,
			},
		})
		expect(resReverseSortNoLimit).toEqual({
			cursor: undefined,
			items: resNoLimit.items.reverse(),
			prevCursor: undefined,
			total: 10,
		})
	})

	test('search with where, sort, cursor, limit = full path', async () => {
		// no cursor (1/4)
		const res1 = await m.search(null, {...q, limit: 3})
		expect(res1).toEqual({
			cursor: '!E~c~6',
			items: sampleSortedItems.slice(0, 3),
			prevCursor: '!!F~d~8',
			total: 10,
		})

		// => move to next cursor  (2/4)
		const res2 = await m.search(null, {...q, limit: 3, cursor: res1.cursor})
		expect(res2).toEqual({
			cursor: '!D~a~1',
			items: sampleSortedItems.slice(3, 6),
			prevCursor: '!!E~e~13',
			total: 10,
		})

		// => move to next cursor (3/4)
		const res3 = await m.search(null, {...q, limit: 3, cursor: res2.cursor})
		expect(res3).toEqual({
			cursor: '!C~b~4',
			items: sampleSortedItems.slice(6, 9),
			prevCursor: '!!D~c~7',
			total: 10,
		})

		// => move to next cursor (4/4)
		const res4 = await m.search(null, {
			...q,
			limit: 3,
			cursor: res3.cursor,
		})
		expect(res4).toEqual({
			items: sampleSortedItems.slice(9),
			cursor: undefined,
			prevCursor: '!!C~d~9',
			total: 10,
		})

		// => move to prev cursor (1/3)
		const res3prev = await m.search(null, {
			...q,
			limit: 3,
			cursor: res4.prevCursor,
		})

		expect(res3prev).toEqual(res3)

		// => move to prev cursor  (2/3)
		const res2prev = await m.search(null, {
			...q,
			limit: 3,
			cursor: res3.prevCursor,
		})
		expect(res2prev).toEqual(res2)

		// => move to prev cursor  (3/3)
		const res1prev = await m.search(null, {
			...q,
			limit: 3,
			cursor: res2.prevCursor,
		})
		expect(res1prev).toEqual(res1)

		expect(await m.count(null, {...q, cursor: res3.cursor})).toBe(1)
		expect(await m.count(null, {...q, cursor: res3.prevCursor})).toBe(6)
	})

	test('search with where, sort, cursor, limit - limit equals to total', async () => {
		// expect: cursor should be null, when equals total
		const res1 = await m.search(null, {
			...q,
			limit: sampleSortedTotal,
		})
		expect(res1.cursor).toBeFalsy()

		// expect: cursor should be null, when equals total (2 steps)
		const res21 = await m.search(null, {...q, limit: sampleSortedTotal / 2})
		const res22 = await m.search(null, {...q, cursor: res21.cursor})
		expect(res21.cursor).toBeTruthy()
		expect(res22.cursor).toBeFalsy()
	})

	test('search with where, limit, bool sort', async () => {
		const sortWithBool = {s1: -1, s2: 1, x2: -1}

		const res0 = await m.search(null, {...q, sort: sortWithBool})
		expect(res0).toEqual({
			cursor: undefined,
			items: [
				{id: 8, s1: 'F', s2: 'd', x1: 1, x2: true},
				{id: 14, s1: 'F', s2: 'e', x1: 1, x2: true},
				{id: 6, s1: 'E', s2: 'c', x1: 1, x2: true},
				{id: 13, s1: 'E', s2: 'e', x1: 0},
				{id: 11, s1: 'E', s2: 'f', x1: 0},
				{id: 1, s1: 'D', s2: 'a', x1: 0},
				{id: 7, s1: 'D', s2: 'c', x1: 0},
				{id: 2, s1: 'C', s2: 'a', x1: 1, x2: true},
				{id: 4, s1: 'C', s2: 'b', x1: 1, x2: true},
				{id: 9, s1: 'C', s2: 'd', x1: 0},
			],
			prevCursor: undefined,
			total: 10,
		})

		const res1 = await m.search(null, {...q, limit: 4, sort: sortWithBool})
		expect(res1).toEqual({
			cursor: '!E~e~_N~13',
			items: res0.items.slice(0, 4),
			prevCursor: '!!F~d~1~8',
			total: 10,
		})

		const res2 = await m.search(null, {
			...q,
			limit: 4,
			sort: sortWithBool,
			cursor: res1.cursor,
		})
		expect(res2).toEqual({
			cursor: '!C~a~1~2',
			items: res0.items.slice(4, 8),
			prevCursor: '!!E~f~_N~11',
			total: 10,
		})
	})

	test('search with sort, cursor, limit - limit < total, some sorted values = falsyBool', async () => {
		const totalCount = await m.count()
		const falsyBoolFalseCount = await m.count({x2: false})
		const falsyBoolTrueCount = await m.count({x2: true})

		const pageCount = falsyBoolTrueCount + 1
		// to make sure there are results on page2
		expect(falsyBoolFalseCount - pageCount).toBeTruthy()

		const searchOptions = {
			// true first
			sort: {x2: -1},
			limit: pageCount,
			cols: ['id', 'x2'],
		}
		const page1 = await m.search({}, searchOptions)

		expect(page1).toEqual({
			cursor: '!_N~1',
			items: [
				{id: 2, x2: 1},
				{id: 4, x2: 1},
				{id: 6, x2: 1},
				{id: 8, x2: 1},
				{id: 10, x2: 1},
				{id: 12, x2: 1},
				{id: 14, x2: 1},
				{id: 1},
			],
			prevCursor: '!!1~2',
			total: 14,
		})

		const page2Count = await m.count(
			{},
			{...searchOptions, cursor: page1.cursor}
		)
		const remainingAfterPage1 = totalCount - pageCount
		expect(page2Count).toEqual(
			remainingAfterPage1 < pageCount ? remainingAfterPage1 : pageCount
		)
		const page2 = await m.search({}, {...searchOptions, cursor: page1.cursor})
		expect(page2).toEqual({
			cursor: undefined,
			items: [{id: 3}, {id: 5}, {id: 7}, {id: 9}, {id: 11}, {id: 13}],
			prevCursor: '!!_N~3',
			total: 14,
		})
	})

	test('search with sort, cursor, limit - TEXT column with NULL values', async () => {
		// Create a fresh model with archivedAt column that can be TEXT || NULL
		const model = getModel({
			columns: {
				id: {type: 'INTEGER'},
				name: {type: 'TEXT'},
				archivedAt: {type: 'TEXT'}, // TEXT || NULL column like archivedAt
			},
		})

		// Create test data with mix of NULL and TEXT values in archivedAt
		await model.set({id: 1, name: 'item1', archivedAt: null})
		await model.set({id: 2, name: 'item2', archivedAt: '2024-01-01'})
		await model.set({id: 3, name: 'item3', archivedAt: null})
		await model.set({id: 4, name: 'item4', archivedAt: '2024-01-02'})
		await model.set({id: 5, name: 'item5', archivedAt: null})
		await model.set({id: 6, name: 'item6', archivedAt: '2024-01-03'})

		const totalCount = await model.count()
		expect(totalCount).toBe(6)

		const searchOptions = {
			// Sort by archivedAt descending (non-null values first)
			sort: {archivedAt: -1, id: 1},
			limit: 3,
			cols: ['id', 'name', 'archivedAt'],
		}

		// First page should contain items with archivedAt values
		const page1 = await model.search({}, searchOptions)

		expect(page1.total).toBe(6)
		expect(page1.items).toHaveLength(3)
		expect(page1.items).toEqual([
			{id: 6, name: 'item6', archivedAt: '2024-01-03'},
			{id: 4, name: 'item4', archivedAt: '2024-01-02'},
			{id: 2, name: 'item2', archivedAt: '2024-01-01'},
		])
		expect(page1.cursor).toBeDefined()

		// Second page should contain items with NULL archivedAt values
		const page2 = await model.search(
			{},
			{...searchOptions, cursor: page1.cursor}
		)

		expect(page2.total).toBe(6)
		expect(page2.items).toHaveLength(3)
		expect(page2.items).toEqual([
			{id: 1, name: 'item1'},
			{id: 3, name: 'item3'},
			{id: 5, name: 'item5'},
		])
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
