const { defineConfig } = require('@playwright/test');
const cloudflare = process.env.TEST_HOST === 'cloudflare';
const external = process.env.BASE_URL;
const localUrl = cloudflare ? 'http://127.0.0.1:8787' : 'http://127.0.0.1:5188';
module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: external || localUrl, browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', screenshot: 'only-on-failure' },
  webServer: external ? undefined : {
    command: cloudflare ? 'npx wrangler dev --ip 127.0.0.1 --port 8787' : 'dotnet run --project src/Lakeland.OrderFulfilment.Api --configuration Release --no-build --no-launch-profile --urls http://127.0.0.1:5188',
    url: localUrl + '/health',
    env: { ASPNETCORE_ENVIRONMENT: 'Beta', Storefront__Enabled: 'true', Storefront__PreviewOnly: 'true', Database__ApplyMigrations: 'false' },
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
