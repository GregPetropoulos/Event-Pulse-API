/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */


export { RateLimiter } from './rateLimiter'; // required for Cloudflare DO discovery
import { normalizeEvents } from './helpers';
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

export interface Env {
	TICKETMASTER_API_KEY: string;
	RATE_LIMITER: DurableObjectNamespace;
}

// ----------------------
// Constants & Config
// ----------------------
const ALLOWED_QUERY_PARAMS = new Set(['latlong', 'radius', 'unit', 'size', 'keyword']);
const MAX_RADIUS = 50;
const MAX_SIZE = 50;

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET',
};

// ----------------------
// Worker Entry
// ----------------------
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// ---- ROUTING ----
		if (url.pathname !== '/events') {
			return new Response('Not Found', { status: 404 });
		}

		// ---- RATE LIMITER ----
		const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-Forwarded-For') ?? 'unknown';
		const limiterId = env.RATE_LIMITER.idFromName(ip);
		const limiter = env.RATE_LIMITER.get(limiterId);

		const limitResponse = await limiter.fetch(`https://rate-limit${url.pathname}?city=${url.searchParams.get('city') ?? ''}`);
		if (limitResponse.status === 429) {
			return limitResponse; // Hard limit hit
		}

		const limitData: { allowed: boolean; softWarning?: string; count: number } = await limitResponse.json();

		// ---- INPUT VALIDATION ----
		const latlong = url.searchParams.get('latlong');
		const radiusStr = url.searchParams.get('radius');
		if (!latlong || !radiusStr) {
			return Response.json({ error: 'Missing latlong or radius' }, { status: 400 });
		}

		const [lat, lng] = latlong.split(',').map(Number);
		const radius = Number(radiusStr);

		if (
			isNaN(lat) || isNaN(lng) ||
			lat < -90 || lat > 90 ||
			lng < -180 || lng > 180
		) {
			return Response.json({ error: 'Invalid latlong' }, { status: 400 });
		}

		if (isNaN(radius) || radius <= 0 || radius > MAX_RADIUS) {
			return Response.json({ error: `Radius must be 1-${MAX_RADIUS}` }, { status: 400 });
		}

		// ---- QUERY PARAM ALLOWLIST ----
		const tmUrl = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
		for (const [key, value] of url.searchParams) {
			if (ALLOWED_QUERY_PARAMS.has(key)) {
				tmUrl.searchParams.set(key, value);
			}
		}

		// ---- API KEY ----
		if (!env.TICKETMASTER_API_KEY) {
			return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
		}
		tmUrl.searchParams.set('apikey', env.TICKETMASTER_API_KEY);

		// ---- CACHE LOOKUP (stale-while-revalidate) ----
		const cacheKey = new Request(url.toString(), { method: 'GET' });
		const cache = caches.default;
		const cached = await cache.match(cacheKey);
		if (cached) {
			// async refresh
			ctx.waitUntil(
				(async () => {
					const freshResp = await fetch(tmUrl.toString(), { headers: { Accept: 'application/json' } });
					if (freshResp.ok) {
						const data = await freshResp.json();
						await cache.put(cacheKey, Response.json({ events: normalizeEvents(data) }));
					}
				})()
			);
			return cached;
		}

		// ---- FETCH UPSTREAM ----
		const tmResponse = await fetch(tmUrl.toString(), { headers: { Accept: 'application/json' } });
		if (!tmResponse.ok) {
			const body = await tmResponse.text();
			return Response.json({ error: 'Ticketmaster error', status: tmResponse.status, body }, { status: 502 });
		}

		const rawData = await tmResponse.json();
		const events = normalizeEvents(rawData);

		// ---- RESPONSE & CACHE WRITE ----
		const response = Response.json(
			{ events, softWarning: limitData.softWarning },
			{
				headers: {
					...CORS_HEADERS,
					'Cache-Control': 'public, max-age=300', // 5 min
				},
			}
		);
		await cache.put(cacheKey, response.clone());

		// ---- ANALYTICS (lightweight per city) ----
		if (events.length > 0 && url.searchParams.has('city')) {
			const cityKey = `analytics:${url.searchParams.get('city')}`;
			const cityHits: number[] = (await env.RATE_LIMITER.get(limiterId).fetch(cityKey).then((r) => r.json().then(d => d || []))) ?? [];
			cityHits.push(Date.now());
			await env.RATE_LIMITER.get(limiterId).fetch(cityKey, { method: 'POST', body: JSON.stringify(cityHits) });
		}

		return response;
	},
};
