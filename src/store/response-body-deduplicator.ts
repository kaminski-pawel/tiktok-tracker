import { createHash } from "node:crypto";

import type { CapturedResponse } from "../chrome/network-listener";

export interface ResponseBodyDeduplicator {
    shouldCapture(response: CapturedResponse): boolean;
}

/**
 * Hashes a captured response body into a stable SHA-256 fingerprint.
 *
 * @param body Raw response body text.
 * @returns Hex-encoded SHA-256 digest.
 */
function hashResponseBody(body: string): string {
    return createHash("sha256").update(body).digest("hex");
}

/**
 * Creates an in-memory deduplicator keyed by response body hash.
 *
 * Identical payloads are treated as duplicate captures for the lifetime of one
 * tracker process, regardless of request id or timestamp differences.
 *
 * @returns Deduplicator instance.
 */
export function createResponseBodyDeduplicator(): ResponseBodyDeduplicator {
    const seenBodyHashes = new Set<string>();

    return {
        shouldCapture(response: CapturedResponse): boolean {
            const bodyHash = hashResponseBody(response.body);
            if (seenBodyHashes.has(bodyHash)) {
                return false;
            }

            seenBodyHashes.add(bodyHash);
            return true;
        }
    };
}