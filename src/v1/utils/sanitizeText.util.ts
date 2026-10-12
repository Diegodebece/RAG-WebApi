// C0 and C1 control characters except tab (\u0009) and line feed (\u000A); also removes \u0000, which PostgreSQL rejects in text
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// half of a surrogate pair without its other half: not valid UTF-16, so it cannot become valid UTF-8
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const BYTE_ORDER_MARK = /﻿/g;

// Cleans text extracted by the browser before it is chunked and stored.
// Returns an empty string when nothing readable is left; the caller decides whether that is an error.
export const sanitizeText = (text: string): string => text
    .replace(LONE_SURROGATE, "�")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .replace(BYTE_ORDER_MARK, "")
    .trim();
