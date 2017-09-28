import test from 'ava'
import {getModel} from './_helpers'

class Foo {
	getF() {
		return this.f
	}
}

test('ItemClass set', async t => {
	const m = getModel({ItemClass: Foo})
	const setted = await m.set({id: 4, f: 'meep'})
	t.true(setted instanceof Foo)
	t.is(setted.getF(), 'meep')
})
test('ItemClass get', async t => {
	const m = getModel({ItemClass: Foo})
	await m.set({id: 4, f: 'meep'})
	const saved = await m.get(4)
	t.true(saved instanceof Foo)
	t.is(saved.getF(), 'meep')
})
test('ItemClass getall', async t => {
	const m = getModel({ItemClass: Foo, columns: {id: {type: 'INTEGER'}}})
	await Promise.all([0, 1, 2, 3, 4].map(id => m.set({id})))
	const saved = await m.getAll([2, 4, 1])
	t.true(saved.every(r => r instanceof Foo))
	t.true(saved.every(r => r.id))
})
test('ItemClass find', async t => {
	const m = getModel({ItemClass: Foo})
	const obj = {id: 'foobar', f: true}
	await m.set(obj)
	const saved = await m.searchOne({id: obj.id})
	t.true(saved instanceof Foo)
	t.is(saved.getF(), true)
})
