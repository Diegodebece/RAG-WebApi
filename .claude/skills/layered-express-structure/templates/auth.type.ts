// what a token carries
export interface TokenPayload {
    id: string;
    role: string;
}

// what authenticateMiddleware puts in req.decoded: the payload, plus when the token expires (milliseconds since 1970)
export interface DecodedToken extends TokenPayload {
    expiresAt: number;
}
