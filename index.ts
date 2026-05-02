/**
 * JIIT Web Portal CORS Proxy - Cloudflare Worker
 *
 * Current expectation:
 * - Worker ingress remains on standard HTTPS.
 * - Worker egress can fetch the configured JIIT backend, including port 6011
 *   when Wrangler compatibility enables custom ports (allow_custom_ports).
 */

interface Env {
  JIIT_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
}

// Default configuration (can be overridden by environment variables)
const DEFAULT_JIIT_API_BASE =
  "https://webportal.jiit.ac.in:6011/StudentPortalAPI";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://yashmalik.tech", // jportal production
  "https://codeblech.github.io", // jportal production
  "http://localhost:5173", // jportal local dev
  "http://localhost:4173", // jportal preview
  "http://127.0.0.1:5173", // alternative local dev
  "http://127.0.0.1:4173", // alternative preview
  "https://jmut.de",
  "https://jportal.jmut.de",
];
const DEFAULT_UPSTREAM_TIMEOUT_MS = 15000;

/**
 * Get configuration from environment or defaults
 */
function getConfig(env: Env) {
  const JIIT_API_BASE = env.JIIT_API_BASE || DEFAULT_JIIT_API_BASE;
  const ALLOWED_ORIGINS = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",")
    : DEFAULT_ALLOWED_ORIGINS;
  const UPSTREAM_TIMEOUT_MS = Number(
    env.UPSTREAM_TIMEOUT_MS || DEFAULT_UPSTREAM_TIMEOUT_MS,
  );

  return { JIIT_API_BASE, ALLOWED_ORIGINS, UPSTREAM_TIMEOUT_MS };
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
function isOriginAllowed(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (!origin) return false;
  return allowedOrigins.some((allowed) => origin.startsWith(allowed));
}

/**
 * Get CORS headers with the appropriate origin
 */
function getCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  const corsOrigin = isOriginAllowed(origin, allowedOrigins)
    ? origin
    : allowedOrigins[0];
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": corsOrigin || "*",
    Vary: "Origin",
  };
}

/**
 * Validate that the target URL is a JIIT API endpoint
 */
function isValidJiitUrl(url: string, apiBase: string): boolean {
  try {
    const parsedApiBase = new URL(apiBase);
    const parsedTarget = new URL(url);
    return (
      parsedTarget.protocol === parsedApiBase.protocol &&
      parsedTarget.hostname === parsedApiBase.hostname &&
      parsedTarget.port === parsedApiBase.port &&
      parsedTarget.pathname.startsWith(parsedApiBase.pathname)
    );
  } catch {
    return false;
  }
}

function buildTargetUrl(apiBase: string, targetPath: string): string {
  const base = new URL(apiBase);
  const normalizedTargetPath = targetPath.startsWith("/")
    ? targetPath
    : `/${targetPath}`;
  const basePath = base.pathname.endsWith("/")
    ? base.pathname.slice(0, -1)
    : base.pathname;

  let finalPath = normalizedTargetPath;
  if (
    normalizedTargetPath.startsWith(`${basePath}/`) ||
    normalizedTargetPath === basePath
  ) {
    finalPath = normalizedTargetPath;
  } else {
    finalPath = `${basePath}${normalizedTargetPath}`;
  }

  base.pathname = finalPath;
  return base.toString();
}

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const withCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: withCause.cause,
    };
  }
  return { value: String(error) };
}

/**
 * Handle OPTIONS preflight requests
 */
async function handleOptions(
  request: Request,
  allowedOrigins: string[],
): Promise<Response> {
  const origin = request.headers.get("Origin");
  console.log(
    `[${new Date().toISOString()}] OPTIONS preflight from origin: ${origin || "none"}`,
  );

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
  allowedOrigins: string[],
  upstreamTimeoutMs: number,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const timestamp = new Date().toISOString();

  console.log(`\n[${timestamp}] ===== Incoming Request =====`);
  console.log(`Method: ${request.method}`);
  console.log(`Origin: ${origin || "none"}`);
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
      return new Response(
        "Missing target path. Use ?path=/StudentPortalAPI/... or /proxy/StudentPortalAPI/...",
        {
          status: 400,
          headers: getCorsHeaders(origin, allowedOrigins),
        },
      );
    }

    const targetUrl = buildTargetUrl(apiBase, targetPath);
    console.log(`Target URL: ${targetUrl}`);

    // Validate it's a JIIT URL (security check)
    if (!isValidJiitUrl(targetUrl, apiBase)) {
      console.log(`[${timestamp}] ERROR: Invalid JIIT URL - ${targetUrl}`);
      return new Response(
        "Invalid target URL. Only JIIT API endpoints are allowed.",
        {
          status: 403,
          headers: getCorsHeaders(origin, allowedOrigins),
        },
      );
    }

    // Prepare headers for the proxied request
    const proxyHeaders = new Headers();
    proxyHeaders.set(
      "Content-Type",
      request.headers.get("Content-Type") || "application/json",
    );
    const upstreamBase = new URL(apiBase);
    const upstreamOrigin = `${upstreamBase.protocol}//${upstreamBase.host}`;
    proxyHeaders.set("Origin", upstreamOrigin);
    proxyHeaders.set("Referer", `${upstreamOrigin}/`);
    proxyHeaders.set(
      "User-Agent",
      request.headers.get("User-Agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    // Forward custom headers
    if (request.headers.has("Authorization")) {
      const authHeader = request.headers.get("Authorization")!;
      proxyHeaders.set("Authorization", authHeader);
      console.log(
        `Authorization header present: ${authHeader.substring(0, 20)}...`,
      );
    }
    if (request.headers.has("LocalName")) {
      const localName = request.headers.get("LocalName")!;
      proxyHeaders.set("LocalName", localName);
      console.log(`LocalName header present: ${localName.substring(0, 20)}...`);
    }

    // Capture request body once so we can both log and forward exactly.
    let body: string | null = null;
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      body = await request.text();
    }

    const upstreamRequestLog = {
      timestamp,
      method: request.method,
      url: targetUrl,
      headers: headersToObject(proxyHeaders),
      bodyLength: body?.length || 0,
      body,
    };
    console.log(`[${timestamp}] ===== Upstream Request =====`);
    console.log(JSON.stringify(upstreamRequestLog, null, 2));

    console.log(
      `[${timestamp}] Forwarding to JIIT API (timeout ${upstreamTimeoutMs}ms)...`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(`Upstream timeout after ${upstreamTimeoutMs}ms`);
    }, upstreamTimeoutMs);

    let response: Response;
    try {
      // Fetch from JIIT API
      response = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    const upstreamResponseLog = {
      timestamp: new Date().toISOString(),
      status: response.status,
      statusText: response.statusText,
      headers: headersToObject(response.headers),
      bodyLength: responseText.length,
      body: responseText,
    };
    console.log(`[${timestamp}] ===== Upstream Response =====`);
    console.log(JSON.stringify(upstreamResponseLog, null, 2));

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
      if (!key.toLowerCase().startsWith("access-control-")) {
        proxyResponse.headers.set(key, value);
      }
    }

    console.log(`[${timestamp}] ===== Request Complete =====\n`);
    return proxyResponse;
  } catch (error) {
    console.error(`[${timestamp}] ===== Proxy Error =====`);
    console.error(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          error: serializeError(error),
          note: "Error during upstream fetch or proxy handling",
        },
        null,
        2,
      ),
    );
    console.error(`===== End Error =====\n`);

    const isTimeout =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.message.includes("timeout"));

    return new Response(
      `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`,
      {
        status: isTimeout ? 504 : 502,
        headers: getCorsHeaders(origin, allowedOrigins),
      },
    );
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const { JIIT_API_BASE, ALLOWED_ORIGINS, UPSTREAM_TIMEOUT_MS } =
      getConfig(env);

    // Handle root path - return info page
    if (url.pathname === "/" || url.pathname === "") {
      console.log(`[${new Date().toISOString()}] Info page accessed`);
      return new Response(
        JSON.stringify(
          {
            service: "JIIT Web Portal CORS Proxy",
            version: "2.0.0",
            usage: {
              method1: "/proxy?path=/StudentPortalAPI/endpoint",
              method2: "/proxy/StudentPortalAPI/endpoint",
            },
            allowedOrigins: ALLOWED_ORIGINS,
            targetApi: JIIT_API_BASE,
            upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
            note: "Cloudflare Worker version",
            status: "ACTIVE",
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Handle health check endpoint
    if (url.pathname === "/health") {
      const healthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        note: "Proxy endpoint is active",
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
      if (
        request.method === "GET" ||
        request.method === "HEAD" ||
        request.method === "POST"
      ) {
        return handleRequest(
          request,
          JIIT_API_BASE,
          ALLOWED_ORIGINS,
          UPSTREAM_TIMEOUT_MS,
        );
      } else {
        return new Response(null, {
          status: 405,
          statusText: "Method Not Allowed",
        });
      }
    }

    // 404 for unknown paths
    console.log(
      `[${new Date().toISOString()}] 404 Not Found: ${request.method} ${url.pathname}`,
    );
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
