/**
 * JIIT Web Portal CORS Proxy - Cloudflare Worker (ARCHIVED - NON-FUNCTIONAL)
 *
 * ⚠️ THIS IMPLEMENTATION DOES NOT WORK ⚠️
 *
 * Reason: Cloudflare Workers cannot proxy requests to specific ports.
 * JIIT's API runs on port 6011 (https://webportal.jiit.ac.in:6011), but Cloudflare Workers
 * can only make requests to standard ports (80 for HTTP, 443 for HTTPS).
 *
 * When attempting to fetch from https://webportal.jiit.ac.in:6011, Cloudflare Workers
 * will strip the port and make the request to https://webportal.jiit.ac.in:443 instead,
 * which fails.
 *
 * Solution: Use the Node.js/Express version (server.js) which can be deployed on Render
 * or any Node.js hosting platform that supports custom ports.
 *
 * This file is kept for reference purposes only.
 *
 * Date archived: 2026-01-16
 */

interface Env {
  JIIT_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
}

// Default configuration (can be overridden by environment variables)
const DEFAULT_JIIT_API_BASE = "https://webportal.jiit.ac.in:6011/StudentPortalAPI";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://yashmalik.tech",        // jportal production
  "https://codeblech.github.io",   // jportal production
  "http://localhost:5173",         // jportal local dev
  "http://localhost:4173",         // jportal preview
  "http://127.0.0.1:5173",         // alternative local dev
  "http://127.0.0.1:4173",         // alternative preview
];

/**
 * Get configuration from environment or defaults
 */
function getConfig(env: Env) {
  const JIIT_API_BASE = env.JIIT_API_BASE || DEFAULT_JIIT_API_BASE;
  const ALLOWED_ORIGINS = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',')
    : DEFAULT_ALLOWED_ORIGINS;

  return { JIIT_API_BASE, ALLOWED_ORIGINS };
}

// CORS headers
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, LocalName",
  "Access-Control-Max-Age": "86400",
};

/**
 * Check if the request origin is allowed
 */
function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.some(allowed => origin.startsWith(allowed));
}

/**
 * Get CORS headers with the appropriate origin
 */
function getCorsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  const corsOrigin = isOriginAllowed(origin, allowedOrigins) ? origin : allowedOrigins[0];
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": corsOrigin || "*",
    "Vary": "Origin",
  };
}

/**
 * Validate that the target URL is a JIIT API endpoint
 */
function isValidJiitUrl(url: string, apiBase: string): boolean {
  try {
    // Check if the URL starts with JIIT_API_BASE (which may include path)
    return url.startsWith(apiBase);
  } catch {
    return false;
  }
}

/**
 * Handle OPTIONS preflight requests
 */
async function handleOptions(request: Request, allowedOrigins: string[]): Promise<Response> {
  const origin = request.headers.get("Origin");
  console.log(`[${new Date().toISOString()}] OPTIONS preflight from origin: ${origin || 'none'}`);

  if (
    origin &&
    request.headers.get("Access-Control-Request-Method") &&
    request.headers.get("Access-Control-Request-Headers")
  ) {
    // Handle CORS preflight requests
    return new Response(null, {
      headers: getCorsHeaders(origin, allowedOrigins),
    });
  }

  // Handle standard OPTIONS request
  return new Response(null, {
    headers: {
      Allow: "GET, HEAD, POST, OPTIONS",
    },
  });
}

/**
 * Handle the proxy request
 */
async function handleRequest(
  request: Request,
  apiBase: string,
  allowedOrigins: string[]
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const timestamp = new Date().toISOString();

  console.log(`\n[${timestamp}] ===== Incoming Request =====`);
  console.log(`Method: ${request.method}`);
  console.log(`Origin: ${origin || 'none'}`);
  console.log(`Path: ${url.pathname}`);
  console.log(`Query: ${JSON.stringify(Object.fromEntries(url.searchParams))}`);

  try {
    // Extract the target path from query parameter or path
    // Supports two formats:
    // 1. /proxy?path=/StudentPortalAPI/token/generate
    // 2. /proxy/StudentPortalAPI/token/generate
    let targetPath = url.searchParams.get("path");

    if (!targetPath) {
      // Extract path from URL pathname (remove /proxy prefix)
      const pathname = url.pathname;
      const proxyPrefix = "/proxy";
      if (pathname.startsWith(proxyPrefix)) {
        targetPath = pathname.slice(proxyPrefix.length);
      }
    }

    if (!targetPath) {
      console.log(`[${timestamp}] ERROR: Missing target path`);
      return new Response("Missing target path. Use ?path=/StudentPortalAPI/... or /proxy/StudentPortalAPI/...", {
        status: 400,
        headers: getCorsHeaders(origin, allowedOrigins),
      });
    }

    // Ensure path starts with /
    if (!targetPath.startsWith("/")) {
      targetPath = "/" + targetPath;
    }

    // Construct the full JIIT API URL
    const targetUrl = `${apiBase}${targetPath}`;
    console.log(`Target URL: ${targetUrl}`);

    // Validate it's a JIIT URL (security check)
    if (!isValidJiitUrl(targetUrl, apiBase)) {
      console.log(`[${timestamp}] ERROR: Invalid JIIT URL - ${targetUrl}`);
      return new Response("Invalid target URL. Only JIIT API endpoints are allowed.", {
        status: 403,
        headers: getCorsHeaders(origin, allowedOrigins),
      });
    }

    // Prepare headers for the proxied request
    const proxyHeaders = new Headers();
    proxyHeaders.set("Content-Type", request.headers.get("Content-Type") || "application/json");
    proxyHeaders.set("Origin", "https://webportal.jiit.ac.in:6011"); // Make JIIT think this is same-origin (just origin, no path)
    proxyHeaders.set("Referer", "https://webportal.jiit.ac.in:6011/"); // Add referer to look more legitimate
    proxyHeaders.set("User-Agent", request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    // Forward custom headers
    if (request.headers.has("Authorization")) {
      const authHeader = request.headers.get("Authorization")!;
      proxyHeaders.set("Authorization", authHeader);
      console.log(`Authorization header present: ${authHeader.substring(0, 20)}...`);
    }
    if (request.headers.has("LocalName")) {
      const localName = request.headers.get("LocalName")!;
      proxyHeaders.set("LocalName", localName);
      console.log(`LocalName header present: ${localName.substring(0, 20)}...`);
    }

    console.log(`Headers being sent to JIIT:`);
    console.log(JSON.stringify(Object.fromEntries(proxyHeaders.entries()), null, 2));

    // Get request body for POST/PUT/PATCH
    let body: string | null = null;
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      body = await request.text();
      if (body) {
        console.log(`Body type: ${typeof body}`);
        console.log(`Body length: ${body.length} bytes`);
        console.log(`Body preview: ${body.substring(0, 50)}...`);
      } else {
        console.log(`No body in ${request.method} request`);
      }
    }

    console.log(`[${timestamp}] Forwarding to JIIT API...`);

    // Fetch from JIIT API
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: body,
    });

    console.log(`[${timestamp}] Response from JIIT: ${response.status} ${response.statusText}`);
    console.log(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

    // Get response body
    const responseText = await response.text();
    console.log(`Response body length: ${responseText.length} bytes`);

    // Log response body for debugging (especially for errors)
    if (response.status >= 400 || responseText.length < 500) {
      console.log(`Response body: ${responseText}`);
    } else {
      console.log(`Response body preview: ${responseText.substring(0, 200)}...`);
    }

    // Create a new response with CORS headers
    const proxyResponse = new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(),
    });

    // Apply CORS headers
    const corsHeaders = getCorsHeaders(origin, allowedOrigins);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      proxyResponse.headers.set(key, value);
    });

    // Forward response headers (except CORS-related ones)
    for (const [key, value] of response.headers.entries()) {
      if (!key.toLowerCase().startsWith('access-control-')) {
        proxyResponse.headers.set(key, value);
      }
    }

    console.log(`[${timestamp}] ===== Request Complete =====\n`);
    return proxyResponse;
  } catch (error) {
    console.error(`[${timestamp}] ===== Proxy Error =====`);
    console.error(`Error type: ${error instanceof Error ? error.constructor.name : 'Unknown'}`);
    console.error(`Error message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    console.error(`===== End Error =====\n`);

    return new Response(`Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`, {
      status: 502,
      headers: getCorsHeaders(origin, allowedOrigins),
    });
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { JIIT_API_BASE, ALLOWED_ORIGINS } = getConfig(env);

    // Handle root path - return info page
    if (url.pathname === "/" || url.pathname === "") {
      console.log(`[${new Date().toISOString()}] Info page accessed`);
      return new Response(
        JSON.stringify({
          service: "JIIT Web Portal CORS Proxy",
          version: "2.0.0",
          usage: {
            method1: "/proxy?path=/StudentPortalAPI/endpoint",
            method2: "/proxy/StudentPortalAPI/endpoint",
          },
          allowedOrigins: ALLOWED_ORIGINS,
          targetApi: JIIT_API_BASE,
          note: "Cloudflare Worker version - ARCHIVED (cannot proxy to port 6011)",
          status: "NON-FUNCTIONAL",
          workingAlternative: "Use Node.js version (server.js) deployed on Render",
        }, null, 2),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Handle health check endpoint
    if (url.pathname === "/health") {
      const healthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        note: "Health endpoint available but proxy is non-functional (port 6011 limitation)",
      };
      console.log(`[${healthStatus.timestamp}] Health check`);
      return new Response(JSON.stringify(healthStatus, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Handle OPTIONS preflight
    if (request.method === "OPTIONS") {
      return handleOptions(request, ALLOWED_ORIGINS);
    }

    // Handle proxy requests
    if (url.pathname.startsWith("/proxy")) {
      if (request.method === "GET" || request.method === "HEAD" || request.method === "POST") {
        return handleRequest(request, JIIT_API_BASE, ALLOWED_ORIGINS);
      } else {
        return new Response(null, {
          status: 405,
          statusText: "Method Not Allowed",
        });
      }
    }

    // 404 for unknown paths
    console.log(`[${new Date().toISOString()}] 404 Not Found: ${request.method} ${url.pathname}`);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
