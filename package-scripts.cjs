/* eslint-disable @typescript-eslint/no-var-requires */
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
			? `git reset ${comparisonRef} && vitest --coverage --color --segfault-retry 5 --changed; out=$?; git reset HEAD@{1}; exit $out`
			: `vitest run --coverage --color --segfault-retry 5`,
		full: 'vitest run --coverage --color --segfault-retry 5',
		watch: 'vitest --color --watch',
	},
	publish: `npx np`,
}

module.exports = {scripts}
