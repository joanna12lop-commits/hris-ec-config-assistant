import "server-only";

import { createHash } from "node:crypto";

const requestLimit = 10;
const windowDurationMs = 10 * 60 * 1000;
const maximumTrackedClients = 2000;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const clientRequests = new Map<string, RateLimitEntry>();

function removeOldestClientIfNeeded(): void {
  if (clientRequests.size > maximumTrackedClients) {
    const oldestKey = clientRequests.keys().next().value;
    if (oldestKey) clientRequests.delete(oldestKey);
  }
}

function getClientKey(request: Request): string {
  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  const address =
    forwardedAddress || request.headers.get("x-real-ip") || "unknown";

  return createHash("sha256").update(address).digest("hex");
}

export function checkAnalysisRateLimit(request: Request) {
  const now = Date.now();
  for (const [key, entry] of clientRequests) {
    if (entry.resetAt <= now) {
      clientRequests.delete(key);
    }
  }

  const key = getClientKey(request);
  const existing = clientRequests.get(key);

  if (!existing || existing.resetAt <= now) {
    clientRequests.set(key, { count: 1, resetAt: now + windowDurationMs });
    removeOldestClientIfNeeded();
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= requestLimit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  existing.count += 1;

  removeOldestClientIfNeeded();

  return { allowed: true, retryAfterSeconds: 0 };
}
