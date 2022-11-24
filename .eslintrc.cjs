/* eslint sort-keys: "error" */

// The nicest rules
const nicest = {
	'@typescript-eslint/no-unused-vars': [
		'error',
		// allow unused vars starting with _
		{
			argsIgnorePattern: '^_',
			ignoreRestSiblings: true,
			varsIgnorePattern: '^_',
		},
	],
	'default-param-last': 1,
	eqeqeq: [2, 'allow-null'], // == and != are nice for null+undefined
	'no-console': 2, // we want a clean console - eslint-disable every wanted one
	'no-implicit-coercion': [2, {allow: ['!!']}], // !! is fun
	'no-shadow': 2, // sometimes causes logic bugs.
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
	'@typescript-eslint/no-explicit-any': 0,
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
	'unicorn/no-await-expression-member': 0,
	'unicorn/no-nested-ternary': 0,
	'unicorn/no-null': 0,
	'unicorn/no-process-exit': 0,
	'unicorn/no-typeof-undefined': 0,
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
		'vitest-globals/env': true,
	},
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:vitest-globals/recommended',
		'plugin:promise/recommended',
		'plugin:unicorn/recommended',
		// Keep this last, it overrides all style rules
		'plugin:prettier/recommended',
	],
	ignorePatterns: ['/build/**/*', '/coverage/**/*', '/dist/**/*'],
	parser: '@typescript-eslint/parser',
	plugins: ['promise', 'unicorn', 'jsdoc', '@typescript-eslint'],
	reportUnusedDisableDirectives: true,
	rules,
}
