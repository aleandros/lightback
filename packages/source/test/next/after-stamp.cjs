// This existing loader MUST run after stamping, even though it is a webpack pre loader.
// Moving lines exposes reversed ordering and broken source-map chaining through SWC.
const { transformSync } = require('@babel/core');
module.exports = function (code, map) {
  if (this.resourcePath.endsWith('/Counter.tsx') && !code.includes('app/Counter.tsx:')) {
    throw new Error('The existing loader ran before Lightback source stamping');
  }
  if (this.resourcePath.endsWith('/Counter.tsx') && !code.includes('__FIRST_LOADER_WORKED______')) {
    throw new Error('The original overlapping host rules ran in the wrong order');
  }
  const result = transformSync(code, {
    filename: this.resourcePath,
    sourceFileName: require('node:path').basename(this.resourcePath),
    babelrc: false, configFile: false, browserslistConfigFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    sourceMaps: true, inputSourceMap: map,
  });
  // Insert two lines and keep the map aligned. Replacing this text keeps its length.
  result.map.mappings = ';;' + result.map.mappings;
  result.map.file = require('node:path').basename(this.resourcePath);
  this.callback(null, '\n\n' + result.code.replaceAll('__FIRST_LOADER_WORKED______', '__EXISTING_LOADER_WORKED___'), result.map);
};
