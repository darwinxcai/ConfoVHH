import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const chromiumExecutablePath = process.env.CONFOVHH_CHROMIUM_EXECUTABLE;
const browserProxy = process.env.CONFOVHH_BROWSER_PROXY;
const ignoreManagedProxyCertificateErrors = process.env.CONFOVHH_BROWSER_IGNORE_HTTPS_ERRORS === "1";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    proxy: browserProxy
      ? { server: browserProxy, bypass: "localhost,127.0.0.1" }
      : undefined,
    ignoreHTTPSErrors: ignoreManagedProxyCertificateErrors,
    launchOptions: chromiumExecutablePath
      ? {
          executablePath: chromiumExecutablePath,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        }
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: chromiumExecutablePath ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- --port 4173 --hostname 127.0.0.1",
    cwd: repositoryRoot,
    url: "http://127.0.0.1:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
