import {randomString, slugifyString} from './slugify'

test('randomString', () => {
	const values = {}
	let i = 0
	let duplicateCount = 0
	while (i < 100_000) {
		const val = randomString(8)
		expect(val).toHaveLength(8)
		if (values[val]) {
			duplicateCount++
		}
		values[val] = 1
		i++
	}
	expect(duplicateCount <= 1).toBe(true)
})

test('slugifyString', () => {
	const cmp = (o, s) => expect(slugifyString(o)).toBe(s)
	cmp(' rostuLR"st  wfpunq 🤗', 'rostulr-st-wfpunq')
	cmp('hi there', 'hi-there')
	cmp('hi there.', 'hi-there')
	// eslint-disable-next-line no-loss-of-precision
	cmp(2_341_234_901_283_740_987, '2341234901283741000')
	cmp('1234567890!@#$`|&*()+-={}[];:\\\'"%^_~nice!', '1234567890!-*-nice')
	cmp({meep: 'yoyo'}, 'yoyo')
	cmp({a: true, meep: 'yoyo'}, 'yoyo')
	cmp({a: '', meep: 'yoyo'}, 'yoyo')
	cmp(0, '0')
	expect(() => slugifyString()).toThrow()
	expect(() => slugifyString('')).toThrow()
	expect(() => slugifyString(null)).toThrow()
	expect(() => slugifyString([])).toThrow()
	expect(() => slugifyString(0, true)).not.toThrow()
	expect(slugifyString(null, true).length === 12).toBe(true)
})
