# Event Pulse API

A hardened, production-ready backend API built on Cloudflare Workers that securely proxies the Ticketmaster Discovery API for mobile applications.

## This API exists to:

- Protect private API keys
- Enforce rate limits suitable for mobile apps
- Normalize Ticketmaster data into a frontend-friendly format
- Cache aggressively to control cost and latency
- Serve as the foundation for future features (venues, artists, analytics)

## 🧠  Why This API Exists

Mobile apps must never call third-party APIs like Ticketmaster directly.

Problems with direct client access:

- API keys are exposed and easily abused

- No rate limiting → runaway costs

- No caching → slow + expensive

- No control over request shape

- No place to evolve business logic

- **Event Pulse API solves all of this**.

## 🏗 Architecture Overview

- Cloudflare Workers (edge runtime, global, zero cold starts)

- Durable Objects for per-IP rate limiting

- Stale-While-Revalidate caching using Cloudflare Cache API

- Ticketmaster Discovery API as the upstream data source

- No database required (yet)

```
Mobile App
   ↓
Event Pulse API (Cloudflare Worker)
   ↓
Ticketmaster Discovery API
```

## 🔐 Security & Hardening
### 1. API Key Protection

- Ticketmaster API key is stored as a Cloudflare secret

- Never exposed to clients

- Never committed to GitHub

### 2. Rate Limiting (Durable Objects)

Per-IP, per-route limits with soft warnings and hard blocks:

| Window | Soft Limit | Hard Limit|
|---     |---         |---        |
| 10s    | 8          | 10        |
| 1m     | 25         | 30        |
| 15m	   | 180	      | 200       |
| 24h    | 1800       | 2000      |

- Soft limits return warnings (UX-friendly)

- Hard limits return 429 with Retry-After

- Limits are route-aware (/events, future /venues)

## 🚦 Request Validation

All incoming requests are strictly validated.

### Required Query Params

- latlong=LAT,LNG

- radius=NUMBER

### Validation Rules

- Latitude: -90 → 90

- Longitude: -180 → 180

- Radius: 1 → 50 miles (mobile-safe)

Invalid requests are rejected before hitting Ticketmaster.

## 🧹 Query Parameter Allowlist

Only these parameters are forwarded upstream:

```javascript
latlong
radius
unit
size
keyword
```

Anything else is silently dropped to:

- Prevent abuse

- Avoid unexpected upstream costs

- Keep behavior predictable

## ⚡ Caching Strategy (Stale-While-Revalidate)

The API uses edge caching to balance freshness and performance.

- Cache TTL: 5 minutes

- Cached responses return instantly

- Background refresh updates cache asynchronously

### This dramatically reduces:

- Latency

- Ticketmaster request volume

- API costs

## 📦 Response Normalization

Ticketmaster responses are large and inconsistent.

This API normalizes them into a simple, stable shape:

```typescript
export type Event = {
  id: string;
  title: string;
  date: string;
  venue: string;
  city: string;
  lat: number;
  lng: number;
  image: string | null;
  url: string;
};

```

### Frontend benefits:

- No Ticketmaster-specific logic

- Smaller payloads

- Easy mapping to lists & maps


## 📍 Analytics (Lightweight)

The API tracks request volume per city (edge-safe, low cost).

### Purpose:

- Understand usage patterns

- Prepare for future dashboards

- Inform caching & rate-limit tuning

- No personal data is stored.

## 🌐 API Endpoints
GET /events

Fetch nearby events by location.

#### Example
```
curl "https://event-pulse-api.workers.dev/events?latlong=40.7128,-74.0060&radius=10"
```

#### Response
```json
{
  "events": [
    {
      "id": "Z7r9jZ1AdFA",
      "title": "Live Concert",
      "date": "2026-02-12",
      "venue": "Madison Square Garden",
      "city": "New York",
      "lat": 40.7505,
      "lng": -73.9934,
      "image": "https://...",
      "url": "https://ticketmaster.com/..."
    }
  ],
  "softWarning": "Approaching rate limit for 60s window"
}
```
## 🧪 Local Development
### Requirements

- Node 18+

- Wrangler CLI

#### Setup
```
npm install
wrangler dev
```
Environment variables are loaded from .env (not committed).

## 🚀 Deployment
```
wrangler deploy
```
#### Uses:

- wrangler.jsonc

- Durable Object migrations (new_sqlite_classes)

- Cloudflare Free Plan compatible

## 🔮 Roadmap

Planned next steps:

- /venues endpoint

- Artist search

- Pagination support

- Observability dashboard

- Feature-based service layer

- Optional auth (per-user limits)

## 🧠 Design Philosophy

- Mobile-first

- Cost-aware

- Secure by default

- Edge-native

- Built to scale without rewrites

## 🧑‍💻 Author

Built by Greg Petropoulos as the backend foundation for the Event Pulse mobile app.