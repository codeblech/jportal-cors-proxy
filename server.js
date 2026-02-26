/**
 * JIIT Web Portal CORS Proxy - Node.js/Express Server
 *
 * This Express server acts as a CORS proxy specifically for the JIIT Web Portal API.
 * It allows the jportal frontend to bypass CORS restrictions that were recently
 * implemented by JIIT's backend.
 *
 * Unlike Cloudflare Workers, Node.js can proxy to specific ports (6011).
 *
 * Security: Locked down to only proxy requests to webportal.jiit.ac.in:6011
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const JIIT_API_BASE =
  process.env.JIIT_API_BASE ||
  "https://webportal.jiit.ac.in:6011/StudentPortalAPI";
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://yashmalik.tech,https://codeblech.github.io,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173"
).split(",");

// Middleware - handle both JSON and raw/encrypted payloads
// Don't parse body automatically - we'll handle it manually in the proxy handler
app.use(
  express.raw({
    type: "*/*", // Accept all content types
    limit: "10mb",
  }),
);

/**
 * Check if the request origin is allowed
 */
function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));
}

/**
 * Get CORS headers with the appropriate origin
 */
function getCorsHeaders(origin) {
  const corsOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": corsOrigin || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, LocalName",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Validate that the target URL is a JIIT API endpoint
 */
function isValidJiitUrl(url) {
  try {
    const parsedUrl = new URL(url);
    // Check if the URL starts with JIIT_API_BASE (which may include path)
    return url.startsWith(JIIT_API_BASE);
  } catch {
    return false;
  }
}

/**
 * Apply CORS headers to response
 */
function applyCorsHeaders(res, origin) {
  const headers = getCorsHeaders(origin);
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

// Root endpoint - info page
app.get("/", (req, res) => {
  console.log(
    `[${new Date().toISOString()}] Info page accessed from ${req.ip}`,
  );
  res.json({
    service: "JIIT Web Portal CORS Proxy",
    version: "2.0.0",
    usage: {
      method1: "/proxy?path=/StudentPortalAPI/endpoint",
      method2: "/proxy/StudentPortalAPI/endpoint",
    },
    allowedOrigins: ALLOWED_ORIGINS,
    targetApi: JIIT_API_BASE,
    note: "Node.js version - supports port 6011 (Cloudflare Workers cannot)",
  });
});

// Health check endpoint for Render
app.get("/health", (req, res) => {
  const healthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };
  console.log(
    `[${healthStatus.timestamp}] Health check - uptime: ${healthStatus.uptime.toFixed(2)}s`,
  );
  res.status(200).json(healthStatus);
});

// OPTIONS preflight handler
app.options("/proxy*", (req, res) => {
  const origin = req.headers.origin;
  console.log(
    `[${new Date().toISOString()}] OPTIONS preflight from origin: ${origin || "none"}`,
  );
  applyCorsHeaders(res, origin);
  res.status(200).end();
});

// Main proxy handler
app.all("/proxy*", async (req, res) => {
  const origin = req.headers.origin;
  const timestamp = new Date().toISOString();

  console.log(`\n[${timestamp}] ===== Incoming Request =====`);
  console.log(`Method: ${req.method}`);
  console.log(`Origin: ${origin || "none"}`);
  console.log(`Path: ${req.path}`);
  console.log(`Query: ${JSON.stringify(req.query)}`);

  try {
    // Extract the target path from query parameter or path
    // Supports two formats:
    // 1. /proxy?path=/StudentPortalAPI/token/generate
    // 2. /proxy/StudentPortalAPI/token/generate
    let targetPath = req.query.path;

    if (!targetPath) {
      // Extract path from URL pathname (remove /proxy prefix)
      const pathname = req.path;
      const proxyPrefix = "/proxy";
      if (pathname.startsWith(proxyPrefix)) {
        targetPath = pathname.slice(proxyPrefix.length);
      }
    }

    if (!targetPath) {
      console.log(`[${timestamp}] ERROR: Missing target path`);
      applyCorsHeaders(res, origin);
      return res
        .status(400)
        .send(
          "Missing target path. Use ?path=/StudentPortalAPI/... or /proxy/StudentPortalAPI/...",
        );
    }

    // Ensure path starts with /
    if (!targetPath.startsWith("/")) {
      targetPath = "/" + targetPath;
    }

    // Construct the full JIIT API URL
    const targetUrl = `${JIIT_API_BASE}${targetPath}`;
    console.log(`Target URL: ${targetUrl}`);

    // Validate it's a JIIT URL (security check)
    if (!isValidJiitUrl(targetUrl)) {
      console.log(`[${timestamp}] ERROR: Invalid JIIT URL - ${targetUrl}`);
      applyCorsHeaders(res, origin);
      return res
        .status(403)
        .send("Invalid target URL. Only JIIT API endpoints are allowed.");
    }

    // Prepare headers for the proxied request
    const proxyHeaders = {
      "Content-Type": req.headers["content-type"] || "application/json",
      Origin: "https://webportal.jiit.ac.in:6011", // Make JIIT think this is same-origin (just origin, no path)
      Referer: "https://webportal.jiit.ac.in:6011/", // Add referer to look more legitimate
      "User-Agent":
        req.headers["user-agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", // Forward user agent
    };

    // Forward custom headers
    if (req.headers["authorization"]) {
      proxyHeaders["Authorization"] = req.headers["authorization"];
      console.log(
        `Authorization header present: ${req.headers["authorization"].substring(0, 20)}...`,
      );
    }
    if (req.headers["localname"]) {
      proxyHeaders["LocalName"] = req.headers["localname"];
      console.log(
        `LocalName header present: ${req.headers["localname"].substring(0, 20)}...`,
      );
    }

    console.log(`Headers being sent to JIIT:`);
    console.log(JSON.stringify(proxyHeaders, null, 2));

    // Prepare fetch options
    const fetchOptions = {
      method: req.method,
      headers: proxyHeaders,
    };

    // Add body for POST requests (and other methods that support body)
    // The body comes as a Buffer from express.raw(), convert to string
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      req.body &&
      req.body.length > 0
    ) {
      if (Buffer.isBuffer(req.body)) {
        fetchOptions.body = req.body.toString("utf-8");
        console.log(`Body type: Buffer (encrypted/serialized payload)`);
        console.log(`Body length: ${fetchOptions.body.length} bytes`);
        console.log(`Body preview: ${fetchOptions.body.substring(0, 50)}...`);
      } else {
        fetchOptions.body =
          typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        console.log(`Body type: ${typeof req.body}`);
        console.log(`Body length: ${fetchOptions.body.length} bytes`);
      }
    } else if (req.method === "POST") {
      console.log(`No body in POST request`);
    }

    console.log(`[${timestamp}] Forwarding to JIIT API...`);

    // Make the request to JIIT API
    const response = await fetch(targetUrl, fetchOptions);

    console.log(
      `[${timestamp}] Response from JIIT: ${response.status} ${response.statusText}`,
    );
    console.log(
      `Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`,
    );

    // Get response body
    const buf = Buffer.from(await response.arrayBuffer());
    console.log(`Response body length: ${buf.length} bytes`);

    // Log response body for debugging (especially for errors)
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("json") || contentType.includes("text")) {
      const responseText = buf.toString("utf8");

      if (response.status >= 400 || responseText.length < 500) {
        console.log(`Response body: ${responseText}`);
      } else {
        console.log(
          `Response body preview: ${responseText.substring(0, 200)}...`,
        );
      }
    } else {
      console.log(
        `Binary response detected (${contentType}) - skipping body log`,
      );
    }

    // Apply CORS headers
    applyCorsHeaders(res, origin);

    // Forward response headers (except CORS-related ones)
    for (const [key, value] of response.headers.entries()) {
      if (!key.toLowerCase().startsWith("access-control-")) {
        res.setHeader(key, value);
      }
    }

    // Send response
    res.status(response.status).send(buf);

    console.log(`[${timestamp}] ===== Request Complete =====\n`);
  } catch (error) {
    console.error(`[${timestamp}] ===== Proxy Error =====`);
    console.error(`Error type: ${error.constructor.name}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error stack: ${error.stack}`);
    console.error(`===== End Error =====\n`);

    applyCorsHeaders(res, origin);
    res.status(502).send(`Proxy error: ${error.message || "Unknown error"}`);
  }
});

// 404 handler
app.use((req, res) => {
  console.log(
    `[${new Date().toISOString()}] 404 Not Found: ${req.method} ${req.path}`,
  );
  res.status(404).send("Not Found");
});

// Error handler
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ===== Server Error =====`);
  console.error(`Path: ${req.method} ${req.path}`);
  console.error(`Error type: ${err.constructor.name}`);
  console.error(`Error message: ${err.message}`);
  console.error(`Error stack: ${err.stack}`);
  console.error(`===== End Server Error =====\n`);

  const origin = req.headers.origin;
  applyCorsHeaders(res, origin);
  res.status(500).send("Internal Server Error");
});

// Start server
app.listen(PORT, () => {
  console.log("\n=".repeat(60));
  console.log("JIIT CORS Proxy Server - STARTED");
  console.log("=".repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Port: ${PORT}`);
  console.log(`Target API: ${JIIT_API_BASE}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("\nAllowed Origins:");
  ALLOWED_ORIGINS.forEach((origin, index) => {
    console.log(`  ${index + 1}. ${origin}`);
  });
  console.log("\nEndpoints:");
  console.log(`  GET  /           - Service info`);
  console.log(`  GET  /health     - Health check`);
  console.log(`  *    /proxy/*    - JIIT API proxy`);
  console.log("\n" + "=".repeat(60));
  console.log("Server is ready to accept connections");
  console.log("=".repeat(60) + "\n");
});
