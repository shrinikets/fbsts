import type { Auth0Client } from "@auth0/auth0-spa-js";
import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

let clientPromise: Promise<Auth0Client> | null = null;

const getConfig = () => {
	const domain = env.PUBLIC_AUTH0_DOMAIN;
	const clientId = env.PUBLIC_AUTH0_CLIENT_ID;
	const audience = env.PUBLIC_AUTH0_AUDIENCE;

	if (!domain || !clientId) {
		throw new Error("Auth0 public environment variables are missing.");
	}

	return { domain, clientId, audience };
};

export const getAuth0Client = async () => {
	if (!browser) {
		throw new Error("Auth0 client is only available in the browser.");
	}

	if (!clientPromise) {
		const module = await import("@auth0/auth0-spa-js");
		const createAuth0Client =
			(typeof module.default === "function" && module.default) ||
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supports CJS interop
			(typeof (module as any).createAuth0Client === "function" && (module as any).createAuth0Client) ||
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supports legacy interop
			(typeof (module as any) === "function" ? (module as any) : null);
		if (!createAuth0Client) {
			throw new Error("Auth0 SDK failed to load.");
		}
		const { domain, clientId, audience } = getConfig();
		clientPromise = createAuth0Client({
			domain,
			clientId,
			authorizationParams: {
				redirect_uri: `${window.location.origin}/auth/callback`,
				audience: audience || undefined
			},
			cacheLocation: "localstorage",
			useRefreshTokens: true
		});
	}

	return clientPromise;
};

export const isAuthenticated = async () => {
	const client = await getAuth0Client();
	return client.isAuthenticated();
};

export const getAccessToken = async () => {
	const client = await getAuth0Client();
	return client.getTokenSilently();
};
