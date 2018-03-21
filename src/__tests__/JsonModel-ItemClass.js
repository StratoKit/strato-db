import expect from 'expect';
import {getModel} from './_helpers'

class Foo {
	getF() {
		return this.f
	}
}

test('ItemClass set', async () => {
	const m = getModel({ItemClass: Foo})
	const setted = await m.set({id: 4, f: 'meep'})
	expect(setted instanceof Foo).toBe(true)
	expect(setted.getF()).toBe('meep')
})
test('ItemClass get', async () => {
	const m = getModel({ItemClass: Foo})
	await m.set({id: 4, f: 'meep'})
	const saved = await m.get(4)
	expect(saved instanceof Foo).toBe(true)
	expect(saved.getF()).toBe('meep')
})
test('ItemClass getall', async () => {
	const m = getModel({ItemClass: Foo, columns: {id: {type: 'INTEGER'}}})
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const saved = await m.getAll([2, 4, 1])
	expect(saved.every(r => r instanceof Foo)).toBe(true)
	expect(saved.every(r => r.id)).toBe(true)
})
test('ItemClass find', async () => {
	const m = getModel({ItemClass: Foo})
	const obj = {id: 'foobar', f: true}
	await m.set(obj)
	const saved = await m.searchOne({id: obj.id})
	expect(saved instanceof Foo).toBe(true)
	expect(saved.getF()).toBe(true)
})
