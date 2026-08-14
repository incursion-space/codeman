// Monaco editor entry for the Codeman file-preview viewer.
//
// Bundled by scripts/build-monaco-bundle.mjs into a single minified ESM file
// (src/web/public/vendor/monaco/monaco.js) and loaded lazily at runtime via
// dynamic import() the first time the file preview renders text. Web workers
// are served as classic scripts from the same directory and wired up through
// MonacoEnvironment.getWorkerUrl — they must never be loaded from another
// origin, which is why the bundle is committed and served same-origin.
import * as monaco from 'monaco-editor';

self.MonacoEnvironment = {
  getWorkerUrl(moduleId, label) {
    if (label === 'typescript' || label === 'javascript') return '/vendor/monaco/ts.worker.js';
    if (label === 'json') return '/vendor/monaco/json.worker.js';
    if (label === 'css' || label === 'scss' || label === 'less') return '/vendor/monaco/css.worker.js';
    if (label === 'html' || label === 'handlebars' || label === 'razor') return '/vendor/monaco/html.worker.js';
    return '/vendor/monaco/editor.worker.js';
  },
};

self.monaco = monaco;
export default monaco;
