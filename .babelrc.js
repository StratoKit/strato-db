// keep up to date from https://github.com/facebookincubator/create-react-app/blob/master/packages/babel-preset-react-app/index.js

const path = require('path')
const debug = require('debug')
const dbg = debug('strato-db/babel')

const isDev = process.env.NODE_ENV !== 'production'

module.exports = function(context, opts) {
	context.cache(true)
	if (opts == null) {
		opts = {}
	}
	opts.isDev = isDev
	// Workaround to force browser build when webpack config already loaded babel and can't change options
	opts.isBrowser = opts.isBrowser || !!process.env.BROWSER
	dbg('Babel config', JSON.stringify(opts))
	const {reactHot, noModules, inWebpack} = opts
	const plugins = [
		// Cherrypick lodash methods until https://github.com/webpack/webpack/issues/1750
		!isDev && require.resolve('babel-plugin-lodash'),
		// class { handleClick = () => { } }
		require.resolve('@babel/plugin-proposal-class-properties'),
		// { ...todo, completed: true }
		require.resolve('@babel/plugin-proposal-object-rest-spread'),
		// Accessing deeply nested properties: { obj?.foo?.bar?.baz }
		require.resolve('@babel/plugin-proposal-optional-chaining'),
	].filter(Boolean)

	const presets = [
		// Latest stable ECMAScript features
		// But turn off modules so webpack can handle them
		// in dev, compile for our dev targets only
		[
			require.resolve('@babel/preset-env'),
			{
				targets: {node: isDev ? true : '8.0'},
				// this is either `false` or `undefined`
				modules: !noModules && undefined,
				// uncomment this to verify that we don't need polyfills
				// we can ignore the sort polyfill
				// useBuiltIns: 'usage',
				debug: process.env.NODE_ENV !== 'test',
			},
		],
	].filter(Boolean)

	return {
		presets,
		plugins,
	}
}
