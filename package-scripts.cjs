const {series} = require('nps-utils')
const {version} = require('./package.json')

const isPR = process.env.GH_EVENT === 'pull_request'
const comparisonRef = isPR ? `origin/${process.env.BASE_REF}` : 'HEAD^'

const scripts = {
	build: {
		default: `nps build.clean build.lib`,
		git: `sh build-git.sh v${version.split('.')[0]}`,
		clean: '[ ! -e dist-types ] || rm -r dist-types/',
		lib: 'vite build --mode lib',
		types: `tsc --emitDeclarationOnly`,
	},
	lint: {
		default: 'oxlint && oxfmt --check',
		fix: 'oxlint --fix && oxfmt',
	},
	test: {
		default: series.nps('lint', 'test.full'),
		// Note, this changes the repo during the run
		ci: isPR
			? `git reset ${comparisonRef} && vitest --coverage --color --changed; out=$?; git reset HEAD@{1}; exit $out`
			: `vitest run --coverage --color`,
		full: 'vitest run --coverage --color',
		watch: 'vitest --color --watch',
	},
	publish: `npx np`,
}

module.exports = {scripts}
