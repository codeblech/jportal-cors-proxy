/**
 * JIIT Web Portal CORS Proxy
 *
 * This Cloudflare Worker acts as a CORS proxy specifically for the JIIT Web Portal API.
 * It allows the jportal frontend (hosted on GitHub Pages) to bypass CORS restrictions
 * that were recently implemented by JIIT's backend.
 *
 * Security: Locked down to only proxy requests to webportal.jiit.ac.in:6011
 */

interface Env {
  // Define any environment variables here if needed
}

// Configuration
const JIIT_API_BASE = "https://webportal.jiit.ac.in:6011";
const ALLOWED_ORIGINS = [
  "https://codeblech.github.io",  // jportal production
  "http://localhost:5173",         // jportal local dev
  "http://localhost:4173",         // jportal preview
  "http://127.0.0.1:5173",         // alternative local dev
  "http://127.0.0.1:4173",         // alternative preview
];

// CORS headers
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, LocalName",
  "Access-Control-Max-Age": "86400",
};

/**
 * Check if the request origin is allowed
 */
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

/**
 * Get CORS headers with the appropriate origin
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
  const corsOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": corsOrigin || "*",
    "Vary": "Origin",
  };
}

/**
 * Validate that the target URL is a JIIT API endpoint
 */
function isValidJiitUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.origin === JIIT_API_BASE;
  } catch {
    return false;
  }
}

/**
 * Handle OPTIONS preflight requests
 */
async function handleOptions(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");

  if (
    origin &&
    request.headers.get("Access-Control-Request-Method") &&
    request.headers.get("Access-Control-Request-Headers")
  ) {
    // Handle CORS preflight requests
    return new Response(null, {
      headers: getCorsHeaders(origin),
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
async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

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
    return new Response("Missing target path. Use ?path=/StudentPortalAPI/... or /proxy/StudentPortalAPI/...", {
      status: 400,
      headers: getCorsHeaders(origin),
    });
  }

  // Ensure path starts with /
  if (!targetPath.startsWith("/")) {
    targetPath = "/" + targetPath;
  }

  // Construct the full JIIT API URL
  const targetUrl = `${JIIT_API_BASE}${targetPath}`;

  // Validate it's a JIIT URL (security check)
  if (!isValidJiitUrl(targetUrl)) {
    return new Response("Invalid target URL. Only JIIT API endpoints are allowed.", {
      status: 403,
      headers: getCorsHeaders(origin),
    });
  }

  try {
    // Create a new request with the target URL
    // Preserve method, headers, and body from the original request
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    });

    // Set the Origin header to make JIIT think this is same-origin
    proxyRequest.headers.set("Origin", JIIT_API_BASE);

    // Remove the Host header (will be set automatically by fetch)
    proxyRequest.headers.delete("Host");

    // Fetch from JIIT API
    const response = await fetch(proxyRequest);

    // Create a new response with CORS headers
    const proxyResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    // Add CORS headers
    const corsHeaders = getCorsHeaders(origin);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      proxyResponse.headers.set(key, value);
    });

    return proxyResponse;
  } catch (error) {
    console.error("Proxy error:", error);
    return new Response(`Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`, {
      status: 502,
      headers: getCorsHeaders(origin),
    });
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle root path - return info page
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        JSON.stringify({
          service: "JIIT Web Portal CORS Proxy",
          version: "1.0.0",
          usage: {
            method1: "/proxy?path=/StudentPortalAPI/endpoint",
            method2: "/proxy/StudentPortalAPI/endpoint",
          },
          allowedOrigins: ALLOWED_ORIGINS,
          targetApi: JIIT_API_BASE,
        }, null, 2),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Handle OPTIONS preflight
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // Handle proxy requests
    if (url.pathname.startsWith("/proxy")) {
      if (request.method === "GET" || request.method === "HEAD" || request.method === "POST") {
        return handleRequest(request);
      } else {
        return new Response(null, {
          status: 405,
          statusText: "Method Not Allowed",
        });
      }
    }

    // 404 for unknown paths
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
