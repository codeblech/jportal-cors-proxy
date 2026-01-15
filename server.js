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

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const JIIT_API_BASE = process.env.JIIT_API_BASE || "https://webportal.jiit.ac.in:6011";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://yashmalik.tech,https://codeblech.github.io,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173"
).split(',');

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

/**
 * Check if the request origin is allowed
 */
function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

/**
 * Get CORS headers with the appropriate origin
 */
function getCorsHeaders(origin) {
  const corsOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, LocalName',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Validate that the target URL is a JIIT API endpoint
 */
function isValidJiitUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.origin === JIIT_API_BASE;
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
app.get('/', (req, res) => {
  res.json({
    service: 'JIIT Web Portal CORS Proxy',
    version: '1.0.0',
    usage: {
      method1: '/proxy?path=/StudentPortalAPI/endpoint',
      method2: '/proxy/StudentPortalAPI/endpoint',
    },
    allowedOrigins: ALLOWED_ORIGINS,
    targetApi: JIIT_API_BASE,
    note: 'Node.js version - supports port 6011 (Cloudflare Workers cannot)',
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// OPTIONS preflight handler
app.options('/proxy*', (req, res) => {
  const origin = req.headers.origin;
  applyCorsHeaders(res, origin);
  res.status(200).end();
});

// Main proxy handler
app.all('/proxy*', async (req, res) => {
  const origin = req.headers.origin;

  try {
    // Extract the target path from query parameter or path
    // Supports two formats:
    // 1. /proxy?path=/StudentPortalAPI/token/generate
    // 2. /proxy/StudentPortalAPI/token/generate
    let targetPath = req.query.path;

    if (!targetPath) {
      // Extract path from URL pathname (remove /proxy prefix)
      const pathname = req.path;
      const proxyPrefix = '/proxy';
      if (pathname.startsWith(proxyPrefix)) {
        targetPath = pathname.slice(proxyPrefix.length);
      }
    }

    if (!targetPath) {
      applyCorsHeaders(res, origin);
      return res.status(400).send('Missing target path. Use ?path=/StudentPortalAPI/... or /proxy/StudentPortalAPI/...');
    }

    // Ensure path starts with /
    if (!targetPath.startsWith('/')) {
      targetPath = '/' + targetPath;
    }

    // Construct the full JIIT API URL
    const targetUrl = `${JIIT_API_BASE}${targetPath}`;

    // Validate it's a JIIT URL (security check)
    if (!isValidJiitUrl(targetUrl)) {
      applyCorsHeaders(res, origin);
      return res.status(403).send('Invalid target URL. Only JIIT API endpoints are allowed.');
    }

    // Prepare headers for the proxied request
    const proxyHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Origin': JIIT_API_BASE, // Make JIIT think this is same-origin
    };

    // Forward custom headers
    if (req.headers['authorization']) {
      proxyHeaders['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['localname']) {
      proxyHeaders['LocalName'] = req.headers['localname'];
    }

    // Prepare fetch options
    const fetchOptions = {
      method: req.method,
      headers: proxyHeaders,
    };

    // Add body for POST requests
    if (req.method === 'POST' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    console.log(`[${new Date().toISOString()}] ${req.method} ${targetUrl}`);

    // Make the request to JIIT API
    const response = await fetch(targetUrl, fetchOptions);

    // Get response body
    const responseText = await response.text();

    // Apply CORS headers
    applyCorsHeaders(res, origin);

    // Forward response headers (except CORS-related ones)
    for (const [key, value] of response.headers.entries()) {
      if (!key.toLowerCase().startsWith('access-control-')) {
        res.setHeader(key, value);
      }
    }

    // Send response
    res.status(response.status).send(responseText);

  } catch (error) {
    console.error('Proxy error:', error);
    applyCorsHeaders(res, origin);
    res.status(502).send(`Proxy error: ${error.message || 'Unknown error'}`);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not Found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  const origin = req.headers.origin;
  applyCorsHeaders(res, origin);
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(PORT, () => {
  console.log(`JIIT CORS Proxy Server running on port ${PORT}`);
  console.log(`Target API: ${JIIT_API_BASE}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
