import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: ['.next/**', '.next-pages/**', '.next-admin/**', '.tmp/**', 'data/admin/**', 'out/**', 'node_modules/**', 'public/models/**/*.obj', 'public/models/**/*.glb', 'public/decoders/**'],
  },
];

export default config;
