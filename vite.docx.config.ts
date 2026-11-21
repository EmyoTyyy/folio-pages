import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Le module .docx (import, export, bibliothèque docx) est compilé à part :
// scripts/build-single.mjs le range dans son propre bloc compressé, que
// l'application ne décompresse qu'à la première utilisation.
export default defineConfig({
  define: {
    __FOLIO_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: ['es2020', 'chrome111', 'firefox113', 'safari16.4'],
    outDir: 'build/docx',
    emptyOutDir: true,
    sourcemap: false,
    // Terser : 1,5 % de moins qu'esbuild une fois compressé (deux passes).
    minify: 'terser',
    terserOptions: { compress: { passes: 2 }, format: { comments: false } },
    lib: {
      entry: 'src/docx/entry.ts',
      formats: ['iife'],
      name: 'FolioDocxModule',
      fileName: () => 'docx.js',
    },
  },
})
