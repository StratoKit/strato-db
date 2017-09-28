// keep up to date from https://github.com/facebookincubator/create-react-app/blob/master/packages/babel-preset-react-app/index.js

const path = require('path')
const debug = require('debug')
const dbg = debug('stratokit/babel')

const isDev = process.env.NODE_ENV !== 'production'

module.exports = function(context, opts) {
	if (opts == null) {
		opts = {}
	}
	opts.isDev = isDev
	// Workaround to force browser build when webpack config already loaded babel and can't change options
	opts.isBrowser = opts.isBrowser || !!process.env.BROWSER
	dbg('Babel config', JSON.stringify(opts))
	const {reactHot, noModules, inWebpack} = opts
	const plugins = [
		// Support import() syntax
		require.resolve('babel-plugin-syntax-dynamic-import'),
		// Cherrypick lodash methods until https://github.com/webpack/webpack/issues/1750
		!isDev && require.resolve('babel-plugin-lodash'),
		// stage 2, but correct one doesn't work yet - HAS TO COME BEFORE class-properties
		// require.resolve('babel-plugin-transform-decorators-legacy'),
		// class { handleClick = () => { } }
		require.resolve('babel-plugin-transform-class-properties'),
		// { ...todo, completed: true }
		require.resolve('babel-plugin-transform-object-rest-spread'),
		// function* () { yield 42; yield 43; }
		// [
		// 	require.resolve('babel-plugin-transform-regenerator'),
		// 	{
		// 		// Async functions are converted to generators by babel-preset-env
		// 		async: false,
		// 	},
		// ],
		// Polyfills the runtime needed for async/await and generators
		// [
		// 	require.resolve('babel-plugin-transform-runtime'),
		// 	{
		// 		helpers: false,
		// 		polyfill: false,
		// 		regenerator: true,
		// 		// Resolve the Babel runtime relative to the config.
		// 		moduleName: path.dirname(require.resolve('babel-runtime/package')),
		// 	},
		// ],
		// The following two plugins are currently necessary to get
		// babel-preset-env to work with rest/spread. More info here:
		// https://github.com/babel/babel-preset-env#caveats
		// https://github.com/babel/babel/issues/4074
		// const { a, ...z } = obj;
		// require.resolve('babel-plugin-transform-es2015-destructuring'),
		// const fn = ({ a, ...otherProps }) => otherProps;
		// require.resolve('babel-plugin-transform-es2015-parameters'),
		// export x from 'y' (stage 1)
		// require.resolve('babel-plugin-transform-export-extensions'),
		// work with aliases, not necessary when running from webpack
		// !inWebpack && [
		// 	require.resolve('babel-plugin-webpack-alias'),
		// 	{config: path.join(__dirname, 'aliases.js')},
		// ],
		// Adds component stack to warning messages
		// isDev && require.resolve('babel-plugin-transform-react-jsx-source'),
		// Adds __self attribute to JSX which React will use for some warnings
		// isDev && require.resolve('babel-plugin-transform-react-jsx-self'),
		// quick logging of functions by putting "// sitrep" before them
		// isDev && require.resolve('babel-plugin-sitrep'),
		// Support for HMR - keep below transform-regenerator
		// https://github.com/gaearon/react-hot-loader/issues/391
		// reactHot && [require.resolve('react-hot-loader/babel')],
		// regenerator-transform needs this fixed in async TODO still true?
		// [require.resolve('babel-plugin-transform-es2015-for-of')],
		// Adds consistent names to styles
		// [
		// 	require.resolve('babel-plugin-styled-components'),
		// 	// Don't minify or preprocess, it breaks our stuff
		// 	{minify: false, displayName: isDev, ssr: true, preprocess: false},
		// ],
	].filter(Boolean)

	const presets = [
		// Latest stable ECMAScript features
		// But turn off modules so webpack can handle them
		// in dev, compile for our dev targets only
		[
			require.resolve('babel-preset-env'),

			{
				targets: opts.isBrowser
					? {browsers: 'last 2 versions'}
					: // Default to node 8.2 in prod; nixpkgs-stable
						{node: isDev ? true : '8.2.0'},
				// this is either `false` or `undefined`
				modules: !noModules && undefined,
				useBuiltins: 'usage',
				debug: process.env.NODE_ENV !== 'test',
			},
		],
		// JSX, Flow
		// require.resolve('babel-preset-react'),
		// This crashes on build :(
		// !isDev && require.resolve('babel-preset-babili'),
	].filter(Boolean)

	return {
		presets,
		plugins,
	}
}
