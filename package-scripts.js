const {concurrent, rimraf, series} = require('nps-utils')
const {version} = require('./package.json')

const isPR = process.env.GH_EVENT === 'pull_request'
const comparisonRef = isPR ? `origin/${process.env.BASE_REF}` : 'HEAD^'

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
	lint: {
		default: 'eslint .',
		// The setup-node action parses eslint errors, no formatter needed
		ci: isPR
			? `git diff --name-only --diff-filter=ACMRTUXB ${comparisonRef} | grep -E "\\.[jt]sx?$" | xargs -d \\\\n eslint`
			: `eslint .`,
		errors: 'eslint --format visualstudio --quiet .',
		fix: `eslint --fix .; prettier --write .`,
	},
	test: {
		default: concurrent.nps('lint', 'test.full'),
		// Note, this changes the repo during the run
		ci: isPR
			? `git reset ${comparisonRef} && NODE_ENV=test jest --ci --coverage --color --onlyChanged; out=$?; git reset HEAD@{1}; exit $out`
			: `NODE_ENV=test jest --ci --coverage --color`,
		full: 'NODE_ENV=test jest --coverage --color',
		watch: 'NODE_ENV=test jest --color --watch',
	},
	publish: `npm publish --access public`,
}

module.exports = {scripts}
