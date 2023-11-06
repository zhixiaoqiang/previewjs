import { test } from "@playwright/test";
import { previewTest } from "@previewjs/testing";
import path from "path";
import url from "url";
import pluginFactory from "../src/index.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const testApp = path.join(__dirname, "apps", "vue2");

test.describe.parallel("vue2/console", () => {
  const test = previewTest(pluginFactory, testApp);

  test("intercepts logs", async (preview) => {
    await preview.show("src/App.vue:App");
    await preview.iframe.waitForSelector("#app");
    await preview.fileManager.update(
      "src/App.vue",
      `<template>
        <div class="App-updated-1">
          Hello, World!
        </div>
      </template>

      <script>
      export default {
        name: "App",
        created() {
          console.log("Render 1");
        }
      };
      </script>`
    );
    await preview.iframe.waitForSelector(".App-updated-1");
    await preview.expectLoggedMessages.toMatch(["Render 1"], "log");
    await preview.fileManager.update(
      "src/App.vue",
      `<template>
        <div class="App-updated-2">
          Hello, World!
        </div>
      </template>

      <script>
      export default {
        name: "App",
        created() {
          console.log("Render 2");
        }
      };
      </script>`
    );
    await preview.iframe.waitForSelector(".App-updated-2");
    await preview.expectLoggedMessages.toMatch(["Render 2"], "log");
  });
});
