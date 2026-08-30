import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Hetzner currently runs Node 20 LTS for the portfolio. Cueport deliberately
  // targets that same stable runtime without replacing the system installation.
  target: 'node20',
  sourcemap: true,
  packages: 'external'
})
