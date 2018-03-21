const fs = require('fs-extra')

module.exports.commands = {
	build: {
		desc: 'Build',
		args: {watch: {type: 'flag'}},
		run: async (exec, {watch}) => {
			await fs.emptyDir('dist')
			// transpile src/ to dist/
			await exec(
				`babel ${
					watch ? '--watch' : ''
				} -s true --ignore __tests__ -D -d dist/ src/`
			)
		},
	},

	buildGit: {
		desc: 'Build and push to git $BRANCH-build branch',
		run: exec => exec(`sh build-git.sh`),
	},

	test: {
		args: {watch: {type: 'flag'}, inspect: {type: 'flag'}},
		run: async (exec, {watch, inspect}) => {
			if (inspect) {
				await exec(
					`NODE_ENV=test node --inspect ./node_modules/.bin/jest --runInBand --watch`
				)
			} else if (watch) {
				await exec(`NODE_ENV=test jest --color --watch`)
			} else {
				await exec(`eslint src/**/*.js`)
				await exec(`NODE_ENV=test jest --coverage --color`)
			}
		},
	},
}
