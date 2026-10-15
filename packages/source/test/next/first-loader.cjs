module.exports = function (code, map) {
  if (this.resourcePath.endsWith('/Counter.tsx') && !code.includes('app/Counter.tsx:')) {
    throw new Error('The first host rule ran before stamping');
  }
  // Same length: keep the inline map intact for the next independent rule pipeline.
  this.callback(null, code.replaceAll('__LIGHTBACK_LOADER_MARKER__', '__FIRST_LOADER_WORKED______'), map);
};
