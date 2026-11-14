import { build, context } from 'esbuild';

const options = {
  entryPoints: {
    'lascaux-assets/viewer.bundle': 'src/lascaux/viewer.js',
    'chauvet-assets/viewer.bundle': 'src/chauvet/viewer.js',
  },
  outdir: 'public',
  bundle: true,
  minify: true,
};

if (process.argv.includes('--watch')) {
  const compiler = await context({ ...options, sourcemap: true });
  await compiler.watch();
  console.log('Watching viewer source. Run npm start in a second terminal.');
} else {
  await build(options);
}
