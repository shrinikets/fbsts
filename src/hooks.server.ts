import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { env } from "$env/dynamic/public";
import { verifyAuthHeader } from "$lib/server/auth0";

const PUBLIC_PREFIXES = ["/_app", "/favicon", "/robots.txt", "/manifest"];
const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
const rawOrigins =
	env.PUBLIC_APP_ORIGINS ?? "http://localhost:5173,https://fbsts.com,https://www.fbsts.com";
const allowedOrigins = new Set(
	rawOrigins
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
);

const resolveCorsOrigin = (origin: string | null) => {
	if (!origin) {
		return "*";
	}
	if (allowedOrigins.has("*")) {
		return "*";
	}
	return allowedOrigins.has(origin) ? origin : null;
};

const buildCorsHeaders = (origin: string | null) => {
	const resolved = resolveCorsOrigin(origin);
	const headers = new Headers();
	if (!resolved) {
		return headers;
	}
	headers.set("Access-Control-Allow-Origin", resolved);
	headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
	headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	headers.set("Vary", "Origin");
	return headers;
};

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith("/api")) {
		const corsHeaders = buildCorsHeaders(event.request.headers.get("origin"));
		if (event.request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders });
		}
		if (!authBypass) {
			const user = await verifyAuthHeader(event.request.headers.get("authorization"));
			if (!user) {
				return new Response("Unauthorized", { status: 401, headers: corsHeaders });
			}
			event.locals.user = user;
		}
		const response = await resolve(event);
		corsHeaders.forEach((value, key) => {
			response.headers.set(key, value);
		});
		return response;
	}

	if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return resolve(event);
	}

	return resolve(event);
};
