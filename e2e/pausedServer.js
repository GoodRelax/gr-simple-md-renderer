import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The built file served from 127.0.0.1, stopped just before the text `cut`
 * until resume(): the page as it is while the rest of the file is on its
 * way (INV-81). No network throttling is needed, so it works in every
 * browser. The test lets the page reach this origin with
 * extraOrigins.allow(origin) (fixtures.js; loopback only, this test only).
 * @param {string} cut - e.g. the first library data block's start tag
 * @returns {Promise<{url: string, origin: string, resume: Function, close: Function}>}
 */
export async function pausedServer(cut) {
  const html = readFileSync(resolve("output/e2e/index.html"));
  const at = html.indexOf(Buffer.from(cut));
  if (at < 0) throw new Error(`"${cut}" is not in the built file`);
  let release;
  const resumed = new Promise((r) => (release = r));
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.write(html.subarray(0, at));
    await resumed;
    res.end(html.subarray(at));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}/`,
    origin,
    resume: () => release(),
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

/** Where the core starts and where the first library's data starts (tools/fastStartup.mjs). */
export const BEFORE_CORE = '<script>(()=>{"use strict";';
export const BEFORE_LIBRARIES = '<script type="text/plain"';
