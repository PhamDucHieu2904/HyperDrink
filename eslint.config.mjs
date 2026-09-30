import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: ['.next/**', '.next-pages/**', 'out/**', 'node_modules/**', 'public/models/**/*.obj', 'public/models/**/*.glb', 'public/decoders/**'],
  },
];

export default config;
