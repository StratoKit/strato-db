/* eslint sort-keys: "error" */

// The nicest rules
const nicest = {
	'default-param-last': 1,
	eqeqeq: [2, 'allow-null'], // == and != are nice for null+undefined
	'import/first': 1,
	'no-console': 2, // we want a clean console - eslint-disable every wanted one
	'no-implicit-coercion': [2, {allow: ['!!']}], // !! is fun
	'no-shadow': 2, // sometimes causes logic bugs.
	'no-unused-vars': [
		'error',
		{
			argsIgnorePattern: '^_',
			ignoreRestSiblings: true,
			varsIgnorePattern: '^_',
		},
	], // allow unused vars starting with _
	'object-shorthand': 2,
	'prefer-destructuring': [
		2,
		{AssignmentExpression: {array: false, object: false}},
	],
	'prettier/prettier': 1, // don't distract while programming
	'unicorn/consistent-function-scoping': 1,
	'unicorn/expiring-todo-comments': [2, {allowWarningComments: true}],
	'unicorn/no-fn-reference-in-iterator': 1,
	'valid-typeof': [2, {requireStringLiterals: true}],
}

// Would be nice to make these error
const maybe = {
	'no-warning-comments': 1, // set to 0 and remove allowWarning from unicorn rule above
	'require-atomic-updates': 1, // too many false positives
}

// these rules suck
const suck = {
	'capitalized-comments': 0,
	'no-eq-null': 0,
	'no-mixed-operators': 0,
	'one-var': 0,
	'padding-line-between-statements': 0,
	'prefer-template': 0,
	'promise/always-return': 0,
	'promise/no-callback-in-promise': 0,
	'promise/param-names': 0,
	'unicorn/catch-error-name': 0,
	'unicorn/consistent-destructuring': 0,
	'unicorn/explicit-length-check': 0,
	'unicorn/filename-case': 0,
	'unicorn/import-style': 0,
	'unicorn/no-nested-ternary': 0,
	'unicorn/no-null': 0,
	'unicorn/no-process-exit': 0,
	'unicorn/no-useless-undefined': 0,
	'unicorn/number-literal-case': 0,
	'unicorn/prefer-module': 0,
	'unicorn/prefer-node-protocol': 0,
	'unicorn/prevent-abbreviations': 0,
}

const rules = {...nicest, ...maybe, ...suck}

module.exports = {
	env: {
		commonjs: true,
		es6: true,
		node: true,
	},
	extends: [
		'eslint:recommended',
		'plugin:jest/recommended',
		'plugin:import/errors',
		'plugin:import/warnings',
		'plugin:promise/recommended',
		'plugin:unicorn/recommended',
		// Keep this last, it overrides all style rules
		'plugin:prettier/recommended',
	],
	ignorePatterns: ['/coverage/**/*', '/dist/**/*', '/build/**/*'],
	overrides: [
		{
			files: ['**/*.ts'],
			parser: '@typescript-eslint/parser',
			plugins: ['@typescript-eslint'],
		},
		{
			files: ['**/*.d.ts'],
			parser: '@typescript-eslint/parser',
			plugins: ['@typescript-eslint'],
			rules: {
				// don't treat type definitions as unused vars
				'@typescript-eslint/no-unused-vars': rules['no-unused-vars'],
				'no-undef': 0,
				'no-unused-vars': 0,
			},
		},
	],
	parser: '@babel/eslint-parser',
	plugins: ['jest', 'import', 'promise', 'unicorn', 'jsdoc'],
	reportUnusedDisableDirectives: true,
	rules,
	settings: {
		jest: {version: '27'},
	},
}
