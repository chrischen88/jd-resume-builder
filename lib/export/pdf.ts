import "server-only";

import { chromium } from "playwright";

// HTML → PDF with headless Chromium (task 1.25). Offline: scripts are off and
// every request is refused, so only the given HTML is rendered.

/** Print margins. */
const MARGIN = "0.75in";

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "Letter",
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
  } finally {
    await browser.close();
  }
}
