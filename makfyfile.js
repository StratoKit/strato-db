const fs = require('fs-extra')

module.exports.commands = {
	build: {
		desc: 'Build',
		args: {watch: {type: 'flag'}},
		run: async (exec, {watch}) => {
			await fs.emptyDir('dist')
			// transpile src/ to dist/
			await exec(
				`babel ${watch
					? '--watch'
					: ''} -s true --ignore __tests__ -D -d dist/ src/`
			)
		},
	},

	buildGit: {
		desc: 'Build and push to git $BRANCH-build branch',
		run: exec => exec(`sh build-git.sh`),
	},

	test: {
		args: {watch: {type: 'flag'}},
		run: async (exec, {watch}) => {
			if (watch) {
				await exec(`NODE_ENV=test DEBUG_COLORS=yes ava --watch --verbose`)
			} else {
				await exec(`eslint src/**/*.js`)
				await exec(`NODE_ENV=test nyc -r 'text -c' ava`)
			}
		},
	},
}
