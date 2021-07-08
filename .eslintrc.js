module.exports = {
	env: {
		browser: true,
		commonjs: true,
		es6: true,
		node: true,
	},
	parser: '@babel/eslint-parser',
	plugins: ['jest', 'import', 'promise', 'unicorn'],
	settings: {
		// autodetect doesn't work
		jest: {version: 26},
	},
	extends: [
		'eslint:recommended',
		'plugin:jest/recommended',
		'plugin:import/errors',
		'plugin:import/warnings',
		'plugin:promise/recommended',
		'plugin:unicorn/recommended',
		'xo',
		'plugin:prettier/recommended',
	],
	rules: {
		// !! is nice
		'no-implicit-coercion': [2, {allow: ['!!']}],
		// == and != are nice for null+undefined
		eqeqeq: [2, 'allow-null'],
		// allow unused vars starting with _
		'no-unused-vars': [
			'error',
			{varsIgnorePattern: '^_', argsIgnorePattern: '^_'},
		],
		// we want a clean console - eslint-disable every wanted one
		'no-console': 2,
		'object-shorthand': 2,
		// too many false positives
		'require-atomic-updates': 1,

		'capitalized-comments': 0,
		'no-eq-null': 0,
		'no-promise-executor-return': 0,
		'one-var': 0,
		'padding-line-between-statements': 0,
		'prefer-template': 0,
		'promise/param-names': 0,
		'unicorn/catch-error-name': 0,
		'unicorn/explicit-length-check': 0,
		'unicorn/filename-case': 0,
		'unicorn/no-nested-ternary': 0,
		'unicorn/no-null': 0,
		'unicorn/no-useless-undefined': 0,
		'unicorn/numeric-separators-style': 0,
		'unicorn/prefer-module': 0,
		'unicorn/prefer-node-protocol': 0,
		'unicorn/prevent-abbreviations': 0,
	},
}
