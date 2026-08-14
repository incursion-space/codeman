// Mermaid entry for the Codeman file-preview markdown renderer.
//
// Bundled by scripts/build-mermaid-bundle.mjs into a single minified ESM file
// (src/web/public/vendor/mermaid/mermaid.js) and loaded lazily at runtime via
// dynamic import() the first time a markdown file with a ```mermaid fence is
// previewed. Mermaid is ~3.5MB minified / ~1MB gzipped, so it is never loaded
// at page load. The full build (dist/mermaid.esm.mjs) is used rather than the
// package-default mermaid.core build so every diagram type is available.
import mermaid from 'mermaid/dist/mermaid.esm.mjs';

export default mermaid;
