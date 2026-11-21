import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Le build produit un seul script IIFE et une seule feuille de style ;
// scripts/build-single.mjs les compresse ensuite dans le fichier unique.
export default defineConfig({
  define: {
    __FOLIO_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: ['es2020', 'chrome111', 'firefox113', 'safari16.4'],
    outDir: 'build/app',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    // Terser : 1,5 % de moins qu'esbuild une fois compressé (deux passes).
    minify: 'terser',
    terserOptions: { compress: { passes: 2 }, format: { comments: false } },
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'FolioPagesApp',
      fileName: () => 'app.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'app[extname]' },
    },
  },
})
