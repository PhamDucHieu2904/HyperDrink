'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Offline SVG artwork rasterizer for a neutral packaging fallback. */
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');

// A neutral diagram, not product artwork or a 2D SKU render.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<defs><linearGradient id="metal"><stop stop-color="#a8b2bb"/><stop offset=".17" stop-color="#eef1f3"/><stop offset=".38" stop-color="#c5cdd3"/><stop offset=".6" stop-color="#f7f9fa"/><stop offset=".84" stop-color="#bcc6ce"/><stop offset="1" stop-color="#8c99a3"/></linearGradient><radialGradient id="lid"><stop stop-color="#ecf0f2"/><stop offset=".8" stop-color="#bdc6cd"/><stop offset="1" stop-color="#8c99a3"/></radialGradient></defs>
<ellipse cx="400" cy="846" rx="200" ry="25" fill="#183323" opacity=".12"/>
<path d="M235 200 Q230 178 260 165 H540 Q570 178 565 200 L580 250 V774 Q580 830 535 844 H265 Q220 830 220 774 V250 Z" fill="url(#metal)" stroke="#8c99a3" stroke-width="4"/>
<ellipse cx="400" cy="169" rx="144" ry="25" fill="url(#lid)" stroke="#7f8d96" stroke-width="6"/>
<ellipse cx="400" cy="169" rx="125" ry="17" fill="none" stroke="#f7f9fa" stroke-width="3"/>
<ellipse cx="408" cy="169" rx="26" ry="10" fill="#9da8b0" stroke="#73818c" stroke-width="3"/>
<path d="M226 775 Q400 816 574 775" fill="none" stroke="#f8fafb" stroke-width="7"/>
<path d="M251 270 V753" stroke="#fff" opacity=".45" stroke-width="12"/>
<text x="400" y="929" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#274633">330 ml · Alu can</text>
</svg>`;

async function createPoster(output = path.resolve(process.cwd(), '.tmp/demo-can330-poster.png')) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}
module.exports = { createPoster };
if (require.main === module) createPoster(process.argv[2]).then(output => console.log(output)).catch(error => { console.error(error.message); process.exitCode = 1; });
