module.exports = {
  sourceDir: 'dist',
  artifactsDir: 'web-ext-artifacts',
  build: { overwriteDest: true },
  run: {
    startUrl: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  },
};
