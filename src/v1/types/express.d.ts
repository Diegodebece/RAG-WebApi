import type { TokenPayload } from "./auth.type.js";

declare global {
    namespace Express {
        interface Request {
            decoded?: TokenPayload;
            validatedBody?: unknown;
        }
    }
}
