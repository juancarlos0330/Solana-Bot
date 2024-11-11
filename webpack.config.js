const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
	mode: 'development',
	entry: {
		'build': path.join(__dirname, 'src', 'index.js'),
	},
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, 'dist'),
	},
    plugins: [
        new CopyPlugin({
            patterns: [
                { from: "src", to: path.resolve(__dirname, 'dist') },
            ],
        }),
        new CleanWebpackPlugin(),
    ],
}
