import DB from '.'

test('prepares statement', async () => {
	const db = new DB()
	const s = await db.prepare('SELECT 5')
	expect(await s.all()).toEqual([{5: 5}])
	await s.finalize()
	await db.close()
	expect(await s.all()).toEqual([{5: 5}])
	await s.finalize()
	await db.close()
})
