# Cloudflare Worker Implementation (ARCHIVED - NON-FUNCTIONAL)

## ⚠️ This Implementation Does Not Work

This directory contains the original Cloudflare Worker implementation of the JIIT CORS proxy. **It is archived for reference purposes only and does not function correctly.**

### Why It Doesn't Work

**Problem**: Cloudflare Workers **cannot proxy requests to custom ports**.

The JIIT Web Portal API runs on port `6011`:
```
https://webportal.jiit.ac.in:6011/StudentPortalAPI
```

When a Cloudflare Worker attempts to fetch from a URL with a custom port, the Workers runtime **strips the port number** and makes the request to the standard HTTPS port (443) instead:

```javascript
// What we want:
fetch("https://webportal.jiit.ac.in:6011/StudentPortalAPI/token/generate")

// What Cloudflare Workers actually does:
fetch("https://webportal.jiit.ac.in:443/StudentPortalAPI/token/generate")
// or simply:
fetch("https://webportal.jiit.ac.in/StudentPortalAPI/token/generate")
```

This results in requests failing because:
1. The JIIT API is not running on port 443
2. The server responds with 404 or connection errors
3. The proxy cannot function

### Cloudflare Workers Port Limitations

From Cloudflare Workers documentation:
- Workers can only make outbound requests to **standard ports** (80 for HTTP, 443 for HTTPS)
- Custom ports are **not supported** in the Workers runtime
- This is a fundamental limitation of the platform, not a configuration issue

### Solution: Node.js/Express Server

The working implementation is in the root directory (`server.js`), which:
- ✅ Can make requests to custom ports (including port 6011)
- ✅ Can be deployed on Render, Heroku, Railway, or any Node.js hosting
- ✅ Has full control over HTTP requests and headers
- ✅ Maintains all the same security features as this Cloudflare version

## Files in This Directory

- `index.ts` - Original Cloudflare Worker code (non-functional)
- `wrangler.toml` - Cloudflare Workers configuration
- `tsconfig.json` - TypeScript configuration for Workers
- `README.md` - This file

## Date Archived

January 16, 2026

## For Historical Reference

This implementation was initially created because:
1. Cloudflare Workers are free and easy to deploy
2. They have excellent global CDN coverage
3. They seemed like a good fit for a simple proxy

We discovered the port limitation issue during testing when all requests to the JIIT API were failing.

## Migration to Node.js

See the main README.md in the root directory for instructions on deploying the Node.js/Express version to Render or other Node.js hosting platforms.
