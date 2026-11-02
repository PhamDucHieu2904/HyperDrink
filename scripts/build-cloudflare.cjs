'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Cross-platform Node build launcher. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Next's static export uses a custom distDir as the final export directory.
// Keep Cloudflare's root URLs independent of an inherited GitHub Pages prefix.
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_PAGES: 'true', GITHUB_PAGES: 'false', ADMIN_DEMO: 'false', NEXT_PUBLIC_BASE_PATH: '' },
});
if (result.error) process.stderr.write(`Cloudflare build failed: ${result.error.message}\n`);
process.exitCode = result.status ?? 1;
