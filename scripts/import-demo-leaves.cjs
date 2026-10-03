/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated local demo importer. */
const { importDemoArtwork } = require('./import-demo-fruits.cjs');

// Decorative demo greenery, shared within each family. Each flavor receives six
// distinct cutouts for its six leaf slots; media files are uploaded only once.
const familyByFlavor = {
  citrus: 'citrus', berry: 'mint', peach: 'broad', lime: 'citrus',
  'juice30-orange': 'citrus', 'juice30-lime': 'citrus',
  'juice30-strawberry': 'mint', 'juice30-red-grape': 'mint',
  ...Object.fromEntries([
    'apple', 'avocado', 'banana', 'guava', 'longan', 'lychee', 'mango',
    'mangosteen', 'mixed', 'noni', 'passion-fruit', 'papaya', 'peach',
    'pineapple', 'pomegranate', 'rambutan', 'sapodilla', 'soursop',
    'tamarind', 'watermelon',
  ].map(key => [`juice30-${key}`, 'broad'])),
};

function importDemoLeaves(options) {
  return importDemoArtwork({ ...options, role: 'leaf', familyByFlavor });
}
module.exports = { importDemoLeaves, familyByFlavor };
if (require.main === module) importDemoLeaves({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).catch(error => { console.error(error.message); process.exitCode = 1; });
