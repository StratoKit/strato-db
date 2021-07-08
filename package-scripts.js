const {concurrent, rimraf, getBin, series} = require('nps-utils')
const {version} = require('./package.json')

let jestBin
try {
	jestBin = getBin('jest-cli', 'jest')
} catch {
	jestBin = 'pleaseInstallJest'
}

const runBabel = `NODE_ENV=production babel -s true --ignore '**/*.test.js,**/__snapshots__' -d dist/`
const scripts = {
	build: {
		default: `nps build.clean build.babel`,
		clean: rimraf('dist/'),
		babel: `${runBabel} src/`,
		watch: `${runBabel} --watch src/`,
		git: `sh build-git.sh v${version.split('.')[0]}`,
		doc: series(
			`echo '# API' > API.md`,
			`echo >> API.md`,
			`jsdoc2md -f src/*.js src/**/*js >> API.md`,
			`echo >> API.md`,
			`git log -n1 --format=format:"_Generated from %H, %cI_" >> API.md`,
			`prettier --write API.md`
		),
		types: series(
			`jsdoc -t node_modules/tsd-jsdoc/dist -r src -d dist`,
			// https://github.com/englercj/tsd-jsdoc/issues/64
			`echo 'export const DB: DB; export const EventSourcingDB: EventSourcingDB; export const SQLite: SQLite; export const EventQueue: EventQueue; export const applyResult: applyResult; export const ESModel: ESModel; export const JsonModel: JsonModel;' >> dist/types.d.ts`
		),
	},
	test: {
		default: concurrent.nps('test.lint', 'test.full'),
		lint: {
			// This looks nice normally and annotates on github CI
			default: 'eslint --format github .',
			fix: `eslint --fix .; prettier --write .`,
		},
		full: 'NODE_ENV=test jest --coverage --color',
		watch: 'NODE_ENV=test jest --color --watch',
		inspect: `NODE_ENV=test pnpx ndb ${jestBin} --runInBand --watch`,
	},
	publish: `npm publish --access public`,
}

module.exports = {scripts}
