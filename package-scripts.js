const {concurrent, rimraf} = require('nps-utils')
const {version} = require('./package.json')

const runBabel =
	'NODE_ENV=production babel -s true --ignore __tests__ -D -d dist/'
const scripts = {
	build: {
		default: `nps build.clean build.babel`,
		clean: rimraf('dist/'),
		babel: `${runBabel} src/`,
		watch: `${runBabel} --watch src/`,
		git: `sh build-git.sh v${version.split('.')[0]}`,
	},
	test: {
		default: concurrent.nps('test.lint', 'test.full'),
		lint: "eslint 'src/**/*.js'",
		lintFix: `
			eslint --fix 'src/**/*.js';
			prettier --write 'src/**/*.{js,jsx,json,md}'`,
		full: 'NODE_ENV=test jest --coverage --color',
		watch: 'NODE_ENV=test jest --color --watch',
		inspect: `NODE_ENV=test node --inspect ${
			// ok, a little bit of a hack
			require.resolve('jest-cli').replace('build', 'bin')
		} --runInBand --watch`,
	},
}

module.exports = {scripts}
