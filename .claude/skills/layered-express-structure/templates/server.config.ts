import { readIntegerSetting, readListSetting } from "./env.config.js";

export const PORT = readIntegerSetting("PORT", 3000, 1, 65535);

// 127.0.0.1 keeps the API reachable from this computer only; inside Docker HOST must be 0.0.0.0.
export const HOST = process.env.HOST || "127.0.0.1";

// The proxies trusted to tell the client's address in X-Forwarded-For: cloudflared in production. Express takes
// the right-most address in that header that is not one of these proxies, which is the one Cloudflare appended,
// so a client cannot pick its own address by sending the header itself. Without this, every request would come
// from the tunnel and share one rate-limit counter. The default is this computer (cloudflared on the host); with
// cloudflared in another container, list the address or subnet it connects from. Never "true": Express would
// then trust the left-most address, which the client controls.
export const TRUSTED_PROXIES = readListSetting("TRUSTED_PROXIES", ["loopback"]);

// Browser origins allowed to call the API (the frontend's address). Empty means any origin, as during
// development; set it before the API is exposed. Tokens travel in a header, not in cookies, so an open CORS
// policy cannot be used to act as a logged-in user, but there is no reason to leave it open.
export const CORS_ORIGINS = readListSetting("CORS_ORIGINS");
