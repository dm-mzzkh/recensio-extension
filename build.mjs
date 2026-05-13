import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

if (existsSync(outdir)) await rm(outdir, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    'popup/main': 'src/popup/main.ts',
    'library/main': 'src/library/main.ts',
    'editor/main': 'src/editor/main.ts',
    'graph/main': 'src/graph/main.ts',
    'background/index': 'src/background/index.ts',
    'content/index': 'src/content/index.ts',
  },
  bundle: true,
  format: 'iife',
  target: ['firefox115'],
  outdir,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});

async function copyStatic() {
  await cp('public', outdir, { recursive: true });
  await cp('src/popup/index.html', `${outdir}/popup/index.html`);
  await cp('src/library/index.html', `${outdir}/library/index.html`);
  await cp('src/editor/index.html', `${outdir}/editor/index.html`);
  await cp('src/graph/index.html', `${outdir}/graph/index.html`);
}

if (watch) {
  await ctx.watch();
  await copyStatic();
  console.log('watching for changes…');
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
}
