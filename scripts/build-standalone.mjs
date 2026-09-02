/**
 * Bundles the whole game into one self-contained HTML file — no external
 * requests at all — for embedding or sharing as a single link.
 *
 *   node scripts/build-standalone.mjs [outfile]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2] ?? 'dist-standalone/facedown.html';
const dir = 'dist-standalone/build';

execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, FACEDOWN_STANDALONE: '1' },
});

const assets = readdirSync(join(dir, 'assets'));
const js = assets.filter((f) => f.endsWith('.js') && !f.includes('worker'));
const css = assets.filter((f) => f.endsWith('.css'));
const read = (f) => readFileSync(join(dir, 'assets', f), 'utf8');
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<title>Facedown</title>
<meta name="theme-color" content="#090b12">
<style>
html, body { height: 100%; margin: 0; background: #090b12; }
${css.map(read).join('\n')}
</style>
<div id="app"></div>
<script type="module">
${guard(js.map(read).join('\n'))}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
