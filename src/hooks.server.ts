import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { env } from "$env/dynamic/public";
import { verifyAuthHeader } from "$lib/server/auth0";

const PUBLIC_PREFIXES = ["/_app", "/favicon", "/robots.txt", "/manifest"];
const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith("/api")) {
		if (event.request.method === "OPTIONS") {
			return new Response(null, { status: 204 });
		}
		if (!authBypass) {
			const user = await verifyAuthHeader(event.request.headers.get("authorization"));
			if (!user) {
				return new Response("Unauthorized", { status: 401 });
			}
			event.locals.user = user;
		}
	}

	if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return resolve(event);
	}

	return resolve(event);
};
