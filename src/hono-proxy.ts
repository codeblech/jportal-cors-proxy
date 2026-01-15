/**
 * JIIT Web Portal Hono Proxy
 *
 * A Hono-based Cloudflare Worker that proxies requests to JIIT Web Portal.
 * Routes directly to /StudentPortalAPI/* endpoints with header spoofing.
 */

import { Hono } from "hono";

const app = new Hono();

const BACKEND_ORIGIN = "https://webportal.jiit.ac.in:6011";
const ALLOWED_PREFIX = "/StudentPortalAPI";
const ALLOWED_ORIGINS = [
  "https://yashmalik.tech",
  "https://codeblech.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "https://jportal.tashif.codes",
];

// Headers to completely remove (hop-by-hop, proxy-specific, CF-specific)
const STRIP_REQ_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cf-ipcountry",
  "x-real-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  // Also remove these so we can set them ourselves
  "origin",
  "referer",
  "cookie",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
];

const STRIP_RES_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
];

function withCors(headers: Headers, requestOrigin?: string | null) {
  // Only set CORS headers for allowed origins
  if (!requestOrigin || !ALLOWED_ORIGINS.includes(requestOrigin)) {
    return headers;
  }
  headers.set("Access-Control-Allow-Origin", requestOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, LocalName"
  );
  headers.set("Access-Control-Expose-Headers", "*");
  return headers;
}

app.options("*", (c) => {
  // CORS preflight
  const h = withCors(new Headers(), c.req.header("origin"));
  h.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers: h });
});

app.all("*", async (c) => {
  const req = c.req.raw;
  const inUrl = new URL(req.url);

  // Safety: only proxy StudentPortalAPI
  if (!inUrl.pathname.startsWith(ALLOWED_PREFIX)) {
    const h = withCors(
      new Headers({ "Content-Type": "application/json" }),
      req.headers.get("origin")
    );
    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: h }
    );
  }

  const upstreamUrl = new URL(inUrl.pathname + inUrl.search, BACKEND_ORIGIN);

  // Copy & sanitize request headers
  const outHeaders = new Headers(req.headers);
  for (const h of STRIP_REQ_HEADERS) outHeaders.delete(h);

  // Spoof headers to look like a same-origin request from JIIT portal
  outHeaders.set("Origin", BACKEND_ORIGIN);
  outHeaders.set("Referer", `${BACKEND_ORIGIN}/studentportal/`);
  outHeaders.set("Cookie", "has_js=1");
  outHeaders.set("Sec-Fetch-Site", "same-origin");
  outHeaders.set("Sec-Fetch-Mode", "cors");
  outHeaders.set("Sec-Fetch-Dest", "empty");

  // Forward body for non-GET/HEAD
  const method = req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : req.body;

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method,
      headers: outHeaders,
      body,
      redirect: "manual",
    });

    // Copy & sanitize response headers
    const resHeaders = new Headers(upstreamRes.headers);
    for (const h of STRIP_RES_HEADERS) resHeaders.delete(h);
    withCors(resHeaders, req.headers.get("origin"));

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    const errorHeaders = withCors(
      new Headers({ "Content-Type": "application/json" }),
      req.headers.get("origin")
    );

    return new Response(
      JSON.stringify({ error: "Upstream request failed" }),
      { status: 502, headers: errorHeaders }
    );
  }
});

export default app;
