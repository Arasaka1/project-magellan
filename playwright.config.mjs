import { defineConfig } from '@playwright/test';
// CI runners have no GPU, so they render with SwiftShader on the CPU (~4 fps
// here, which slows driving to under half real time). Local macOS runs use the
// Apple GPU through ANGLE Metal instead (60 fps, real-time driving).
// PW_RENDERER=swiftshader reproduces CI locally; PW_RENDERER=metal forces the GPU.
const renderer = process.env.PW_RENDERER || (process.env.CI || process.platform !== 'darwin' ? 'swiftshader' : 'metal');
const rendererArgs = renderer === 'metal' ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'];
export default defineConfig({
  testDir: './tests/browser', timeout: 90000, workers: 1, retries: process.env.CI ? 1 : 0,
  outputDir: 'output/playwright/results', reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8002', viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: rendererArgs } },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:8002', reuseExistingServer: !process.env.CI, timeout: 10000 },
});
