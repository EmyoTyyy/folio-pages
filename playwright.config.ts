import { defineConfig } from '@playwright/test'

// Les tests ouvrent le vrai fichier construit (dist/folio-pages.html) en file://,
// exactement comme un utilisateur qui double-clique dessus.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 900 },
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [
    // En local : le Chrome installé. En CI : le Chromium de Playwright (mêmes API).
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'chromium-ci', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
})
