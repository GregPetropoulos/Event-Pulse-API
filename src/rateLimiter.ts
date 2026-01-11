interface Limit {
	windowMs: number;
	softMax: number; // warn user before hitting hard limit
	hardMax: number; // hard block limit
}

interface RateLimitData {
	allowed: boolean;
	softWarning?: string;
	count: number;
}

const DEFAULT_LIMITS: Limit[] = [
	{ windowMs: 10_000, softMax: 8, hardMax: 10 }, // 10s burst
	{ windowMs: 60_000, softMax: 25, hardMax: 30 }, // 1 min
	{ windowMs: 900_000, softMax: 180, hardMax: 200 }, // 15 min
	{ windowMs: 86_400_000, softMax: 1800, hardMax: 2000 }, // 24h
];

const ROUTE_LIMITS: Record<string, Limit[]> = {
	'/events': DEFAULT_LIMITS,
	// Add other routes here
};

export class RateLimiter {
	state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(req: Request): Promise<Response> {
		const now = Date.now();
		const url = new URL(req.url);
		const route = url.pathname;

		const limits = ROUTE_LIMITS[route] ?? DEFAULT_LIMITS;

		// Load stored hits
		let hits = (await this.state.storage.get<Record<string, number[]>>('hits')) ?? {};
		hits[route] = hits[route] ?? [];

		// Keep only hits within the largest window
		const maxWindow = Math.max(...limits.map((l) => l.windowMs));
		hits[route] = hits[route].filter((ts) => now - ts < maxWindow);

		let softWarning: string | null = null;
		let countInWindow = 0;

		// Check soft & hard limits
		for (const limit of limits) {
			const hitsInWindow = hits[route].filter((ts) => now - ts < limit.windowMs);
			countInWindow = Math.max(countInWindow, hitsInWindow.length);

			if (hitsInWindow.length >= limit.hardMax) {
				const retryAfter = Math.ceil((limit.windowMs - (now - hitsInWindow[0])) / 1000);
				return new Response(
					JSON.stringify({
						error: 'Rate limit exceeded (hard)',
						retryAfter,
						windowMs: limit.windowMs,
						route,
					}),
					{
						status: 429,
						headers: { 'Retry-After': retryAfter.toString() },
					}
				);
			} else if (hitsInWindow.length >= limit.softMax) {
				softWarning = `Approaching limit for window ${limit.windowMs / 1000}s`;
			}
		}

		// Record hit
		hits[route].push(now);
		await this.state.storage.put('hits', hits);

		// ---- ANALYTICS (per route or per city) ----
		// Example: send city name via query param or POST to DO analytics
		if (url.searchParams.has('city')) {
			const cityKey = `analytics:${url.searchParams.get('city')}`;
			const cityHits = (await this.state.storage.get<number[]>(cityKey)) ?? [];
			cityHits.push(now);
			await this.state.storage.put(cityKey, cityHits);
		}

		const data: RateLimitData = {
			allowed: true,
			softWarning: softWarning || undefined,
			count: countInWindow,
		};

		return new Response(JSON.stringify(data), { status: 200 });
	}
}
