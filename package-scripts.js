const {concurrent, series, rimraf} = require('nps-utils')

const runBabel =
	'NODE_ENV=production babel -s true --ignore __tests__ -D -d dist/'
const scripts = {
	build: {
		default: `nps build.clean build.babel`,
		clean: rimraf('dist/'),
		babel: `${runBabel} src/`,
		watch: `${runBabel} --watch src/`,
		git: 'sh build-git.sh',
	},
	test: {
		default: concurrent.nps('test.lint', 'test.full'),
		lint: "eslint 'src/**/*.js'",
		lintFix: series(
			`eslint --fix 'src/**/*.js'`,
			`prettier --write 'src/**/*.{js,jsx,json,md}'`
		),
		full: 'NODE_ENV=test jest --coverage --color',
		watch: 'NODE_ENV=test jest --color --watch',
		inspect: `NODE_ENV=test node --inspect ${require.resolve(
			'jest-cli'
		)} --runInBand --watch`,
	},
}

module.exports = {scripts}
