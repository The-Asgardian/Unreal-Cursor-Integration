const path = require('path');

module.exports = {
  entry: './src/extension.ts',
  target: 'node',
  mode: 'none',
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  output: {
    filename: 'extension.js',
    path: path.resolve(__dirname, 'out'),
    libraryTarget: 'commonjs2'
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

