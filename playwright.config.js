const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5188', browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', screenshot: 'only-on-failure' },
  webServer: {
    command: 'dotnet run --project src/Lakeland.OrderFulfilment.Api --configuration Release --no-build --no-launch-profile --urls http://127.0.0.1:5188',
    url: 'http://127.0.0.1:5188/health',
    env: { ASPNETCORE_ENVIRONMENT: 'Beta', Storefront__Enabled: 'true', Storefront__PreviewOnly: 'true', Database__ApplyMigrations: 'false' },
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
