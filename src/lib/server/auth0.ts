import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "$env/dynamic/public";

const normalizeDomain = (value: string) =>
	value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

const getIssuer = () => {
	const domain = env.PUBLIC_AUTH0_DOMAIN;
	if (!domain) {
		throw new Error("PUBLIC_AUTH0_DOMAIN is not set.");
	}
	return `https://${normalizeDomain(domain)}/`;
};

const getAudience = () => env.PUBLIC_AUTH0_AUDIENCE || env.PUBLIC_AUTH0_CLIENT_ID || "";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const getJwks = () => {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`${getIssuer()}.well-known/jwks.json`));
	}
	return jwks;
};

export type Auth0User = {
	sub: string;
	email?: string;
	name?: string;
};

export const verifyAuthHeader = async (authHeader: string | null): Promise<Auth0User | null> => {
	if (!authHeader) {
		return null;
	}
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		return null;
	}

	const issuer = getIssuer();
	const audience = getAudience();
	if (!audience) {
		throw new Error("Auth0 audience is not configured.");
	}

	try {
		const { payload } = await jwtVerify(match[1], getJwks(), {
			issuer,
			audience
		});
		if (!payload.sub) {
			return null;
		}
		return {
			sub: String(payload.sub),
			email: typeof payload.email === "string" ? payload.email : undefined,
			name: typeof payload.name === "string" ? payload.name : undefined
		};
	} catch {
		return null;
	}
};
