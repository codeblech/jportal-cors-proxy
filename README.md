# JPortal CORS Proxy

A Node.js/Express server that acts as a CORS proxy specifically for the JIIT Web Portal API. This proxy enables the [jportal](https://github.com/codeblech/jportal) frontend to bypass CORS restrictions that were recently implemented by JIIT's backend.

## Why This Exists

JIIT recently added CORS restrictions to their Web Portal API (`webportal.jiit.ac.in:6011`) that only allow same-origin requests. This breaks third-party frontends like jportal that are hosted on different domains (e.g., GitHub Pages).

The official JIIT portal works because it's served from the same origin as the API. Third-party apps see `sec-fetch-site: cross-origin` headers that the backend rejects. Since these `sec-fetch-*` headers are controlled by the browser and cannot be modified by JavaScript, we need a proxy server.

This proxy:
- Receives requests from the jportal frontend
- Forwards them to the JIIT API with the correct `Origin` header
- Returns responses with proper CORS headers
- Is locked down to only proxy JIIT API requests (security)

## Why Node.js Instead of Cloudflare Workers?

**TLDR**: Cloudflare Workers cannot proxy to custom ports.

JIIT's API runs on port `6011` (`https://webportal.jiit.ac.in:6011`). Cloudflare Workers strip custom ports from URLs and only support standard ports (80/443). This makes them unsuitable for this use case.

See `cloudflare/README.md` for details on why the Cloudflare Worker implementation doesn't work.

## Security

This proxy is **locked down** and only allows:
- Proxying to `https://webportal.jiit.ac.in:6011` (no other domains)
- Requests from whitelisted origins (jportal domains)
- Standard HTTP methods: GET, POST, HEAD, OPTIONS

This prevents abuse of the proxy as an open proxy.

## Deployment to Render

### Prerequisites

1. A [Render](https://render.com) account (free tier works)
2. A GitHub account
3. This repository pushed to your GitHub

### Automatic Deployment (Recommended)

1. **Push to GitHub**
   ```bash
   git clone https://github.com/codeblech/jportal-cors-proxy.git
   cd jportal-cors-proxy
   git remote set-url origin https://github.com/YOUR-USERNAME/jportal-cors-proxy.git
   git push -u origin main
   ```

2. **Deploy to Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml` and configure everything
   - Click "Create Web Service"

3. **Your proxy URL**
   - Render will provide a URL like: `https://jportal-cors-proxy.onrender.com`
   - Save this URL for configuring jportal

### Manual Deployment

If you prefer manual configuration:

1. **Create New Web Service** on Render
2. **Configure**:
   - **Name**: `jportal-cors-proxy`
   - **Region**: Singapore (or closest to India)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

3. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `JIIT_API_BASE`: `https://webportal.jiit.ac.in:6011`
   - `ALLOWED_ORIGINS`: `https://yashmalik.tech,https://codeblech.github.io,http://localhost:5173`

4. **Health Check**:
   - Path: `/health`

5. **Deploy**

## Local Development

### Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/codeblech/jportal-cors-proxy.git
   cd jportal-cors-proxy
   npm install
   ```

2. **Create `.env` file**
   ```bash
   cp .env.example .env
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

   Server will run at `http://localhost:3000`

### Testing

Test the proxy:

```bash
# Health check
curl http://localhost:3000/health

# Info endpoint
curl http://localhost:3000/

# Test proxied request (example: token generation)
curl -X POST http://localhost:3000/proxy/StudentPortalAPI/token/generate \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{
    "username": "your-enrollment",
    "password": "your-password",
    "memberType": "S"
  }'
```

## Usage

### API Endpoints

The proxy supports two URL formats:

**Method 1: Query parameter**
```
https://your-proxy.onrender.com/proxy?path=/StudentPortalAPI/token/generate
```

**Method 2: Path-based**
```
https://your-proxy.onrender.com/proxy/StudentPortalAPI/token/generate
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
POST https://your-proxy.onrender.com/proxy/StudentPortalAPI/token/generate
Content-Type: application/json

{
  "username": "...",
  "password": "...",
  "memberType": "S"
}
```

### Integrating with jportal

Update jportal to use the proxy URL when creating WebPortal instances:

```javascript
const portal = new WebPortal({
  useProxy: true,
  proxyUrl: 'https://your-proxy.onrender.com'  // Your Render proxy URL
});
```

See [jsjiit documentation](https://github.com/codeblech/jsjiit) for more details.

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
│  Node.js/Express    │
│  Render Web Service │
└────────┬────────────┘
         │ Request to port 6011
         │ (Origin header set)
         ▼
┌─────────────────────┐
│   JIIT Web Portal   │
│   Backend API:6011  │
└─────────────────────┘
```

## How It Works

1. **Client Request**: jportal makes a request to the proxy (e.g., `render.com/proxy/StudentPortalAPI/token/generate`)

2. **Proxy Processing**:
   - Validates the request origin is whitelisted
   - Validates the target URL is a JIIT API endpoint
   - Creates a new request to JIIT with:
     - Same method, headers, and body
     - `Origin: https://webportal.jiit.ac.in:6011` header (makes it appear same-origin)

3. **JIIT API**:
   - Sees `sec-fetch-site: same-origin` (because request comes from server, not browser)
   - Processes the request normally
   - Returns response

4. **Proxy Response**:
   - Receives JIIT response
   - Adds CORS headers (`Access-Control-Allow-Origin`, etc.)
   - Returns to jportal

5. **Client Receives**: jportal receives the response with proper CORS headers and can process it

## Cost

Render's free tier includes:
- 750 hours per month (enough for 24/7 operation)
- Automatic sleep after 15 minutes of inactivity
- Automatic wake on request

For a student portal proxy, the free tier is sufficient.

## Security Considerations

1. **Whitelisted Origins**: Only requests from known jportal domains are allowed
2. **Locked Down Target**: Only JIIT API can be proxied
3. **No Credential Storage**: Proxy doesn't store or log credentials
4. **HTTPS Only**: All communication is encrypted (Render provides free SSL)
5. **Standard Headers**: All standard security headers are preserved

## Troubleshooting

### "Invalid target URL" error
- Make sure your request path starts with `/StudentPortalAPI`
- Check that you're using the correct proxy URL format

### "502 Bad Gateway" error
- JIIT's backend might be down
- Check JIIT portal availability at https://webportal.jiit.ac.in:6011
- Proxy might be sleeping (Render free tier) - retry after a few seconds

### CORS errors still occurring
- Verify your origin is in the `ALLOWED_ORIGINS` list
- Check proxy logs on Render dashboard
- Ensure you're using the correct proxy URL in jportal

### Proxy is slow
- Render free tier sleeps after 15 minutes of inactivity
- First request after sleep takes 30-60 seconds
- Subsequent requests are fast
- Consider upgrading to paid tier for 24/7 availability

## Environment Variables

Create a `.env` file (see `.env.example`):

```bash
PORT=3000                          # Server port (Render provides this automatically)
JIIT_API_BASE=https://webportal.jiit.ac.in:6011  # JIIT API URL with port
ALLOWED_ORIGINS=https://yashmalik.tech,https://codeblech.github.io  # Whitelisted origins
```

## Project Structure

```
jportal-cors-proxy/
├── server.js              # Main Express server (Node.js proxy)
├── package.json           # Node.js dependencies
├── render.yaml            # Render deployment configuration
├── .env.example           # Environment variable template
├── .gitignore             # Git ignore rules
├── README.md              # This file
└── cloudflare/            # Archived Cloudflare Worker (non-functional)
    ├── index.ts           # Original Worker code
    ├── wrangler.toml      # Worker configuration
    ├── tsconfig.json      # TypeScript config
    └── README.md          # Explanation of why it doesn't work
```

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
