import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

// The client's address, as a key for limits. req.ip is the address a trusted proxy reported (TRUSTED_PROXIES in
// server.config.ts), or the connection's own address otherwise. IPv6 addresses are grouped by network, so one
// client cannot dodge a limit by changing the last part of its address.
export const getClientAddress = (req: Pick<Request, "ip">): string => ipKeyGenerator(req.ip ?? "unknown");
