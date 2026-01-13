# JPortal CORS Proxy

A Cloudflare Worker that acts as a CORS proxy specifically for the JIIT Web Portal API. This proxy enables the [jportal](https://github.com/codeblech/jportal) frontend to bypass CORS restrictions that were recently implemented by JIIT's backend.

## Why This Exists

JIIT recently added CORS restrictions to their Web Portal API (`webportal.jiit.ac.in:6011`) that only allow same-origin requests. This breaks third-party frontends like jportal that are hosted on different domains (e.g., GitHub Pages).

The official JIIT portal works because it's served from the same origin as the API. Third-party apps see `sec-fetch-site: cross-origin` headers that the backend rejects. Since these `sec-fetch-*` headers are controlled by the browser and cannot be modified by JavaScript, we need a proxy server.

This worker:
- Receives requests from the jportal frontend
- Forwards them to the JIIT API with the correct `Origin` header
- Returns responses with proper CORS headers
- Is locked down to only proxy JIIT API requests (security)

## Security

This proxy is **locked down** and only allows:
- Proxying to `https://webportal.jiit.ac.in:6011` (no other domains)
- Requests from whitelisted origins (jportal domains)
- Standard HTTP methods: GET, POST, HEAD, OPTIONS

This prevents abuse of the worker as an open proxy.

## Deployment

### Prerequisites

1. A Cloudflare account (free tier works)
2. Node.js 18+ installed
3. Wrangler CLI (Cloudflare Workers CLI)

### Steps

1. **Clone this repository**
   ```bash
   git clone https://github.com/codeblech/jportal-cors-proxy.git
   cd jportal-cors-proxy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Login to Cloudflare**
   ```bash
   npx wrangler login
   ```

4. **Deploy to Cloudflare Workers**
   ```bash
   npm run deploy
   ```

   This will deploy the worker and give you a URL like:
   ```
   https://jportal-cors-proxy.<your-subdomain>.workers.dev
   ```

5. **Update jportal configuration**

   In your jportal frontend, update the jsjiit API base URL to point to your worker:

   Instead of:
   ```javascript
   const portal = new WebPortal();
   ```

   You'll need to modify jsjiit's base URL or intercept requests. See [Usage](#usage) below.

## Usage

### API Endpoints

The proxy supports two URL formats:

**Method 1: Query parameter**
```
https://your-worker.workers.dev/proxy?path=/StudentPortalAPI/token/generate
```

**Method 2: Path-based**
```
https://your-worker.workers.dev/proxy/StudentPortalAPI/token/generate
```

### Example: Token Generation

**Original JIIT API call:**
```javascript
POST https://webportal.jiit.ac.in:6011/StudentPortalAPI/token/generate
Content-Type: application/json

{
  "username": "...",
  "password": "...",
  "memberType": "S"
}
```

**Through the proxy:**
```javascript
POST https://your-worker.workers.dev/proxy/StudentPortalAPI/token/generate
Content-Type: application/json

{
  "username": "...",
  "password": "...",
  "memberType": "S"
}
```

### Integrating with jsjiit

The jsjiit library hardcodes the JIIT API URL. You have two options:

**Option A: Fork jsjiit and modify the base URL**

1. Fork [jsjiit](https://github.com/codeblech/jsjiit)
2. Change the `API_URL` constant in `src/wrapper.js`:
   ```javascript
   const API_URL = "https://your-worker.workers.dev/proxy";
   ```
3. Build and use your modified version

**Option B: Use a module bundler to replace the URL**

If using Vite (like jportal), add this to `vite.config.js`:
```javascript
export default {
  define: {
    'https://webportal.jiit.ac.in:6011/StudentPortalAPI':
      JSON.stringify('https://your-worker.workers.dev/proxy/StudentPortalAPI')
  }
}
```

**Option C: Patch at runtime (not recommended)**

Intercept fetch calls globally (fragile, not recommended):
```javascript
const originalFetch = window.fetch;
window.fetch = function(...args) {
  let url = args[0];
  if (typeof url === 'string' && url.includes('webportal.jiit.ac.in:6011')) {
    url = url.replace(
      'https://webportal.jiit.ac.in:6011',
      'https://your-worker.workers.dev/proxy'
    );
    args[0] = url;
  }
  return originalFetch.apply(this, args);
};
```

## Configuration

### Allowed Origins

The worker whitelist origins are defined in `src/index.ts`:

```typescript
const ALLOWED_ORIGINS = [
  "https://codeblech.github.io",  // jportal production
  "http://localhost:5173",         // jportal local dev
  "http://localhost:4173",         // jportal preview
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];
```

Add your custom domain if you host jportal elsewhere.

### Preserved Headers

The proxy forwards all headers from the original request, including:
- `Content-Type`
- `Authorization` (Bearer tokens)
- `LocalName` (custom JIIT header)

The proxy sets:
- `Origin: https://webportal.jiit.ac.in:6011` (to make JIIT think it's same-origin)
- Removes `Host` header (set automatically by fetch)

## Development

### Local Development

```bash
npm run dev
```

This starts a local development server at `http://localhost:8787`.

### View Logs

```bash
npm run tail
```

### Testing

Test the proxy with curl:

```bash
# Test the info endpoint
curl https://your-worker.workers.dev/

# Test a proxied request (example: token generation)
curl -X POST https://your-worker.workers.dev/proxy/StudentPortalAPI/token/generate \
  -H "Content-Type: application/json" \
  -H "Origin: https://codeblech.github.io" \
  -d '{
    "username": "your-enrollment",
    "password": "your-password",
    "memberType": "S"
  }'
```

## Architecture

```
┌─────────────────┐
│  jportal (PWA)  │
│  GitHub Pages   │
└────────┬────────┘
         │ CORS request
         │ (cross-origin)
         ▼
┌─────────────────────┐
│  Cloudflare Worker  │
│  CORS Proxy         │
└────────┬────────────┘
         │ Same-origin request
         │ (Origin header set)
         ▼
┌─────────────────────┐
│   JIIT Web Portal   │
│   Backend API       │
└─────────────────────┘
```

## How It Works

1. **Client Request**: jportal makes a request to the worker (e.g., `worker.dev/proxy/StudentPortalAPI/token/generate`)

2. **Worker Processing**:
   - Validates the request origin is whitelisted
   - Validates the target URL is a JIIT API endpoint
   - Creates a new request to JIIT with:
     - Same method, headers, and body
     - `Origin: https://webportal.jiit.ac.in:6011` header (makes it appear same-origin)

3. **JIIT API**:
   - Sees `sec-fetch-site: same-origin` (because request comes from Cloudflare, not browser)
   - Processes the request normally
   - Returns response

4. **Worker Response**:
   - Receives JIIT response
   - Adds CORS headers (`Access-Control-Allow-Origin`, etc.)
   - Returns to jportal

5. **Client Receives**: jportal receives the response with proper CORS headers and can process it

## Cost

Cloudflare Workers free tier includes:
- 100,000 requests per day
- 10ms CPU time per request

For a student portal app, this is more than sufficient. The worker is very lightweight and uses minimal CPU time per request.

## Security Considerations

1. **Whitelisted Origins**: Only requests from known jportal domains are allowed
2. **Locked Down Target**: Only JIIT API can be proxied
3. **No Credential Storage**: Worker doesn't store or log credentials
4. **HTTPS Only**: All communication is encrypted
5. **Standard Headers**: All standard security headers are preserved

## Troubleshooting

### "Invalid target URL" error
- Make sure your request path starts with `/StudentPortalAPI`
- Check that you're using the correct proxy URL format

### "CORS policy" error in browser
- Verify your origin is in the `ALLOWED_ORIGINS` list
- Redeploy the worker after making changes

### "502 Bad Gateway" error
- JIIT's backend might be down
- Check JIIT portal availability at https://webportal.jiit.ac.in:6011

### Worker not deploying
- Make sure you're logged in: `npx wrangler login`
- Check `wrangler.toml` configuration
- Verify your Cloudflare account has Workers enabled

## Contributing

Issues and pull requests are welcome! Please ensure:
- Security best practices are maintained
- Only JIIT API proxying is allowed
- Origin whitelist is properly validated

## License

MIT License - see LICENSE file for details

## Related Projects

- [jportal](https://github.com/codeblech/jportal) - Progressive Web App for JIIT student portal
- [jsjiit](https://github.com/codeblech/jsjiit) - JavaScript wrapper for JIIT Web Portal API

## Disclaimer

This proxy is an educational project to demonstrate CORS workarounds. It is not affiliated with or endorsed by JIIT. Use responsibly and in accordance with your institution's policies.
