import type { DecodedToken } from "./auth.type.js";

declare global {
    namespace Express {
        interface Request {
            decoded?: DecodedToken;
            validatedBody?: unknown;
        }
    }
}
