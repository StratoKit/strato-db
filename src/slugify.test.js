import test from 'ava'
import {randomString, slugifyString} from './slugify'

test('randomString', t => {
	const values = {}
	let i = 0
	let duplicateCount = 0
	while (i < 100000) {
		const val = randomString(8)
		t.is(val.length, 8)
		if (values[val]) {
			duplicateCount++
		}
		values[val] = 1
		i++
	}
	t.true(duplicateCount <= 1, 'There should be no collisions')
})

test('slugifyString', t => {
	const cmp = (o, s) => t.is(slugifyString(o), s)
	cmp(' rostuLR"st  wfpunq 🤗', 'rostulr-st-wfpunq')
	cmp('hi there', 'hi-there')
	cmp(2341234901283740987, '2341234901283741000')
	cmp('1234567890!@#$`|&*()+-={}[];:\\\'"%^_~', '1234567890!-*')
	cmp({meep: 'yoyo'}, 'yoyo')
	cmp(0, '0')
	t.throws(() => slugifyString())
	t.throws(() => slugifyString(''))
	t.throws(() => slugifyString(null))
	t.throws(() => slugifyString([]))
	t.notThrows(() => slugifyString(0, true))
	t.true(slugifyString(null, true).length === 12)
})

test.todo('uniqueSlugId')
