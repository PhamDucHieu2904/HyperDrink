/* eslint-disable @typescript-eslint/no-require-imports -- Offline demo asset generation. */
'use strict';
const fs = require('node:fs');
const sharp = require('sharp');
const panels = [0, 1024, 2048].map(x => `<g transform="translate(${x} 0)">
  <ellipse cy="143" rx="256" ry="86" fill="#fffdf6" stroke="#e9a923" stroke-width="7"/>
  <text y="132" text-anchor="middle" font-family="Arial,sans-serif" font-size="82" font-weight="900" fill="#243d2c">VINUT</text>
  <text y="183" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#4b613c">NATA DE COCO</text>
  <text y="306" text-anchor="middle" font-family="Arial,sans-serif" font-size="94" font-weight="900" fill="#ed9820">MANGO</text>
  <text y="363" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#476b36">JUICE DRINK</text>
  <text y="414" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#35493b">with coconut jelly</text>
  <text y="500" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#64755b">DEMO LABEL · 320 ml</text>
  <g transform="translate(340 320) rotate(-15)"><rect x="-49" y="-49" width="98" height="98" rx="18" fill="#ffc940"/><path d="M-49 -9h98M-9 -49v98" stroke="#fff0b6" stroke-width="7"/></g>
</g>`).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="640" viewBox="0 0 2048 640"><rect width="2048" height="640" fill="#fffdf3"/><path d="M0 550 Q256 510 512 550 T1024 550 T1536 550 T2048 550V640H0Z" fill="#f4b429"/>${panels}</svg>`;
async function main() {
  fs.mkdirSync('public/assets/labels/nata-demo',{recursive:true});
  await sharp(Buffer.from(svg)).webp({quality:90}).toFile('public/assets/labels/nata-demo/mango-pet320.webp');
  // Neutral unprinted sleeve for direct optical comparison with the Unity render.
  const watermelonSleeve='<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="640"><rect width="2048" height="640" fill="#f3f3f3"/></svg>';
  await sharp(Buffer.from(watermelonSleeve)).webp({quality:90}).toFile('public/assets/labels/nata-demo/watermelon-unprinted-pet320.webp');
  // Placeholder required for the initial unpublished model registration; replaced with WebGL capture.
  const poster=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#eaf2e3"/><rect x="206" y="140" width="228" height="433" rx="55" fill="#f6bd32"/><rect x="230" y="67" width="180" height="88" rx="20" fill="#faf9ed"/><rect x="200" y="179" width="240" height="162" rx="28" fill="#fffdf3"/><text x="320" y="236" font-family="Arial" text-anchor="middle" font-size="35" font-weight="900" fill="#243d2c">VINUT</text><text x="320" y="282" font-family="Arial" text-anchor="middle" font-size="27" fill="#ed9820">NATA DE COCO</text><text x="320" y="318" font-family="Arial" text-anchor="middle" font-size="18" fill="#476b36">MANGO · 320 ml</text></svg>`;
  if(!fs.existsSync('public/models/bottles/pet-320-nata-poster.webp')) await sharp(Buffer.from(poster)).webp({quality:90}).toFile('public/models/bottles/pet-320-nata-poster.webp');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
