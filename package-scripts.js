const {series} = require('nps-utils')
const {version} = require('./package.json')

const isPR = process.env.GH_EVENT === 'pull_request'
const comparisonRef = isPR ? `origin/${process.env.BASE_REF}` : 'HEAD^'

const runBabel = `NODE_ENV=production babel -s true --ignore '**/*.test.js,**/__snapshots__' -d dist/`
const scripts = {
	build: {
		default: `nps build.clean build.babel`,
		clean: 'rm -r dist/',
		babel: `${runBabel} src/`,
		watch: `${runBabel} --watch src/`,
		git: `sh build-git.sh v${version.split('.')[0]}`,
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
		default: series.nps('lint', 'test.full'),
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
