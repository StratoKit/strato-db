import expect from 'expect'
import {getModel} from './_helpers'

test('set with id', async () => {
	const m = getModel()
	const obj = {id: 'foobar', fluffy: true}
	const set = await m.set(obj)
	const saved = await m.get(set.id)
	expect(saved).toEqual(obj)
	expect(saved).toEqual(set)
})

test('set with falsy id, BLOB type', async () => {
	const m = getModel({columns: {id: {type: 'BLOB'}}})
	await m.set({id: 0})
	await m.set({id: ''})
	const all = await m.all()
	expect(all).toHaveLength(2)
	expect(all.every(r => !r.id)).toBe(true)
})

test('set without id', async () => {
	const m = getModel()
	const obj = {fluffy: true}
	const saved = await m.set(obj)
	expect(saved.id).toBeTruthy()
	expect(saved.fluffy).toBe(obj.fluffy)
})

test('set without id, INTEGER type', async () => {
	const m = getModel({columns: {id: {type: 'INTEGER'}}})
	const o = await m.set({})
	const all = await m.all()
	expect([o]).toEqual(all)
})

test('INTEGER autoIncrement id', async () => {
	const m = getModel({columns: {id: {type: 'INTEGER', autoIncrement: true}}})
	await m.set({id: 50})
	await m.remove({id: 50})
	await m.set({})
	const all = await m.all()
	expect([{id: 51}]).toEqual(all)
})

test('set with existing id', async () => {
	let val = 5
	const m = getModel({columns: {id: {value: () => val}}})
	await m.set({hi: true})
	const o = await m.searchOne()
	expect(o.id).toBe('5')
	val = 6
	await m.set(o)
	const p = await m.all()
	expect(p).toHaveLength(1)
	expect(p[0].id).toBe('5')
})

test('set(obj, insertOnly)', async () => {
	const m = getModel()
	await m.set({id: 234})
	await expect(m.set({id: 234}, true)).rejects.toThrow('SQLITE_CONSTRAINT')
})

test('set almost empty object', async () => {
	const m = getModel()
	await m.set({id: 'ta'})
	expect(await m.db.all`SELECT * from ${m.name}ID`).toEqual([
		{id: 'ta', json: null},
	])
	expect(await m.all()).toEqual([{id: 'ta'}])
})

test('update(obj)', async () => {
	const m = getModel()
	const obj = await m.update({hi: 5, ho: 8}, true)
	const {id} = obj
	expect(await m.get(id)).toEqual(obj)
	await m.update({id, hi: 7})
	expect(await m.get(id)).toEqual({...obj, hi: 7})
})

test('update(obj, upsert)', async () => {
	const m = getModel()
	await m.set({id: 5, ho: 8})
	await expect(m.update({id: 5, ho: 1})).resolves.toEqual({id: 5, ho: 1})
	await expect(m.update({id: 7, ho: 2})).rejects.toThrow('No object')
	await expect(m.update({id: 7, ho: 3}, true)).resolves.toEqual({id: 7, ho: 3})
	await expect(m.update({ho: 4}, true)).resolves.toMatchObject({ho: 4})
	expect(await m.count()).toBe(3)
})

test('update transactional', async () => {
	const m = getModel()
	await m.db.run(`BEGIN IMMEDIATE`)
	await expect(m.update({id: 5, ho: 9}, true)).rejects.toThrow(
		'cannot start a transaction within a transaction'
	)
})

test('updateNoTrans not transactional', async () => {
	const m = getModel()
	await m.db.run(`BEGIN IMMEDIATE`)
	await expect(m.updateNoTrans({id: 5, ho: 9}, true)).resolves.not.toThrow()
	await m.db.run(`END`)
})

test('.changeId(oldId, newId)', async () => {
	const m = getModel()
	await m.set({id: 'a', t: 1})
	await m.changeId('a', 'b')
	expect(await m.all()).toEqual([{id: 'b', t: 1}])
})
test('.changeId(oldId, existing)', async () => {
	const m = getModel()
	await m.set({id: 'a', t: 1})
	await m.set({id: 'b', t: 2})
	await expect(m.changeId('a', 'b')).rejects.toThrow('SQLITE_CONSTRAINT')
})
test('.changeId(missing, newId)', async () => {
	const m = getModel()
	const p = m.changeId('a', 'b')
	await expect(p).rejects.toThrow('not found')
})
test('.changeId(missing, newId) race', async () => {
	const m = getModel()
	expect(m.changeId('a', 'b')).rejects.toThrow('id a not found')
	await m.set({id: 'a'})
	expect(await m.all()).toEqual([{id: 'a'}])
})
test('.changeId(oldId, invalid)', async () => {
	const m = getModel()
	expect(() => m.changeId('a', null)).toThrow(TypeError)
	expect(() => m.changeId('a', undefined)).toThrow(TypeError)
})
