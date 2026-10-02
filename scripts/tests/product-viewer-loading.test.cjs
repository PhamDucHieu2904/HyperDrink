/* eslint-disable @typescript-eslint/no-require-imports -- SSR tests replace only the GPU runtime and seed its public status for loading/error coverage. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require.extensions['.tsx'] = function(module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(outputText, filename);
};

let statusOverride = null;
let gpuCalls = 0;
const originalLoad = Module._load;
Module._load = function(request, parent, ...args) {
  if (request === '@/lib/viewer/runtime') return { createProductViewer: () => { gpuCalls++; throw new Error('SSR must never initialize a GPU.'); } };
  if (request === 'react' && parent?.filename.replace(/\\/g, '/').endsWith('/components/ProductViewer.tsx')) return {
    ...React,
    useState(initial) {
      const actual = React.useState(initial);
      return initial?.phase && statusOverride ? [statusOverride, actual[1]] : actual;
    },
  };
  return originalLoad.call(this, request, parent, ...args);
};
const ProductViewer = require('../../components/ProductViewer.tsx').default;
const ViewerLoading = require('../../components/catalog-hero/ViewerLoading.tsx').default;
Module._load = originalLoad;

const asset = { id: 'can-user-330', name: 'User uploaded can', src: '/models/user-can.glb', poster: '/catalog/neutral-can-poster.webp', packaging: 'can', volumeMl: 330, materialSlots: { label: ['label-mesh'] } };
function render(props = {}, status = null) {
  statusOverride = status;
  try { return renderToStaticMarkup(React.createElement(ProductViewer, { asset, ...props })); }
  finally { statusOverride = null; }
}
const custom = () => React.createElement(ViewerLoading);

test('catalog viewer initial load uses a compact accessible loader and never displays the neutral silver model poster', () => {
  const html = render({ loadingFallback: custom() });
  assert.match(html, /data-viewer-status="loading"/); assert.match(html, /aria-busy="true"/);
  assert.match(html, /catalog-viewer-loading/); assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/); assert.match(html, /aria-atomic="true"/);
  assert.match(html, /width="72"/); assert.match(html, /height="72"/);
  assert.doesNotMatch(html, /<img|neutral-can-poster|scene-fallback|width:80%|scene-loading/);
  assert.equal(gpuCalls, 0);
});

test('generic callers preserve their existing poster and loading message when no custom loader is supplied', () => {
  const html = render();
  assert.match(html, /scene-fallback/); assert.match(html, /src="\/catalog\/neutral-can-poster.webp"/);
  assert.match(html, /width:80%/); assert.match(html, /scene-loading/);
  assert.doesNotMatch(html, /catalog-viewer-loading/);
});

test('an actual viewer error retains the poster/error fallback and does not keep showing a progress indicator', () => {
  const html = render({ loadingFallback: custom() }, { phase: 'error', assetId: asset.id, hasProduct: false });
  assert.match(html, /data-viewer-status="error"/); assert.match(html, /aria-busy="false"/);
  assert.match(html, /scene-error/); assert.match(html, /scene-fallback/); assert.match(html, /neutral-can-poster/);
  assert.doesNotMatch(html, /catalog-viewer-loading|scene-loading/);
});

test('loading another model while a product remains rendered does not cover that product with either loader or poster', () => {
  const html = render({ loadingFallback: custom() }, { phase: 'loading', assetId: asset.id, hasProduct: true });
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /catalog-viewer-loading|scene-fallback|neutral-can-poster/);
  assert.match(html, /scene-loading/);
});

test('ready status removes all loading and error overlays', () => {
  const html = render({ loadingFallback: custom() }, { phase: 'ready', assetId: asset.id, hasProduct: true, environmentReady: true });
  assert.match(html, /data-viewer-status="ready"/); assert.match(html, /data-environment-ready="true"/); assert.match(html, /aria-busy="false"/);
  assert.doesNotMatch(html, /catalog-viewer-loading|scene-loading|scene-error|scene-fallback|neutral-can-poster/);
});

test('a stale error from a previous model cannot display its poster over the current selection', () => {
  const html = render({ loadingFallback: custom() }, { phase: 'error', assetId: 'previous-can', hasProduct: false });
  assert.doesNotMatch(html, /scene-fallback|neutral-can-poster|catalog-viewer-loading/);
});
