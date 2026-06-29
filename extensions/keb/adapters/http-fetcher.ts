/**
 * adapters/http-fetcher.ts — Fetches URLs and converts HTML → Markdown.
 *
 * Implements the ContentFetcher port using node:https/http (no undici/fetch
 * dependency to avoid version conflicts) and @kreuzberg/html-to-markdown-node.
 */

import { convert } from "@kreuzberg/html-to-markdown-node";
import * as https from "node:https";
import * as http from "node:http";
import type { ContentFetcher, FetchedContent } from "../ports/types";

// ---------------------------------------------------------------------------
// Blocker detection — patterns that indicate the page is not real content
// ---------------------------------------------------------------------------

const BLOCKER_PATTERNS: RegExp[] = [
  /captcha/i,
  /verify (?:you are|that you are) human/i,
  /are you a (?:human|robot)/i,
  /confirm you are human/i,
  /please enable javascript/i,
  /enable javascript/i,
  /js is required/i,
  /javascript (?:is )?required/i,
  /cloudflare/i,
  /checking your browser/i,
  /ddos protection/i,
  /access denied/i,
  /403 forbidden/i,
  /log in to continue/i,
  /please log in/i,
  /subscribe to read/i,
  /paywall/i,
];

/** Check if markdown content is essentially empty or a known blocker page. */
function isBlockedOrEmpty(content: string): boolean {
  const stripped = content.trim();
  if (stripped.length === 0) return true;

  // Very short content → almost certainly skeleton/empty
  const wordCount = stripped
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
  if (wordCount < 15) return true;

  // Blocker pattern match + not substantial
  const hasBlocker = BLOCKER_PATTERNS.some((p) => p.test(content));
  if (hasBlocker && wordCount < 80) return true;

  return false;
}

export class HttpFetcher implements ContentFetcher {
  /**
   * Fetch a URL and convert HTML → Markdown.
   */
  async fetchAndConvert(url: string): Promise<FetchedContent> {
    const html = await httpGet(url);

    if (html.trim().length === 0) {
      throw new Error("Fetched content is empty");
    }

    const result = convert(html);
    if (!result.content || result.content.trim().length === 0) {
      throw new Error("HTML to markdown conversion produced empty output");
    }

    // ── Content quality check ──────────────────────────────
    if (isBlockedOrEmpty(result.content)) {
      throw new Error(
        "EMPTY_CONTENT: The page appears to be empty, a skeleton placeholder, " +
          "or blocked (captcha/login/paywall). Try adding this content directly " +
          "via right-click → \"Add this content into Knowledge base\" instead.",
      );
    }

    return {
      content: result.content,
      title: result.metadata?.document?.title ?? null,
    };
  }
}

/** Simple HTTP GET with redirect-following, IPv4-only, and timeout. */
function httpGet(targetUrl: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = 30_000;

    const doGet = (urlStr: string, redirectsLeft: number) => {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === "https:" ? https : http;

      const req = mod.get(
        urlStr,
        {
          headers: {
            "User-Agent": "pi-keb/0.1.0",
            Accept: "text/html, text/plain",
          },
          family: 4, // force IPv4 — avoids IPv6 timeouts
          timeout,
        },
        (res) => {
          // Redirect
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirectsLeft <= 0) {
              reject(new Error("Too many redirects"));
              return;
            }
            res.resume();
            doGet(
              new URL(res.headers.location, urlStr).toString(),
              redirectsLeft - 1,
            );
            return;
          }

          if (!res.statusCode || res.statusCode >= 400) {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${res.statusMessage || "error"}`,
              ),
            );
            res.resume();
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            resolve(body);
          });
          res.on("error", reject);
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Request timed out"));
      });
    };

    doGet(targetUrl, maxRedirects);
  });
}
