import "server-only";

import {
  generateGroundedAnswer,
  type AnalysisResult,
  type AnalysisMode,
} from "@/lib/openai";
import { searchKnowledgeChunks } from "@/lib/knowledge-search";
import { checkAnalysisRateLimit } from "@/lib/analysis-rate-limit";
import { claimDailyAnalysisSlot, releaseDailyAnalysisSlot } from "@/lib/analysis-daily-limit";
import { dailyAnalysisLimitMessage } from "@/lib/analysis-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseCacheTtlMs = 15 * 60 * 1000;
const maximumCachedResponses = 500;
const answerSchemaVersion = "analysis-answer-v3";

type CachedAnswer = {
  answer: AnalysisResult;
  expiresAt: number;
};

const analysisCache = new Map<string, CachedAnswer>();

function safeErrorDetails(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown server error";
  const name = error instanceof Error ? error.name : "UnknownError";
  const stack = error instanceof Error ? error.stack : undefined;
  const redactCredentials = (value: string) =>
    value.replace(
      /(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{8,})/g,
      "[REDACTED]",
    );

  return {
    name: redactCredentials(name),
    message: redactCredentials(message),
    ...(stack ? { stack: redactCredentials(stack) } : {}),
  };
}

function isAnalysisMode(value: unknown): value is AnalysisMode {
  return value === "advisor" || value === "troubleshooter";
}

function notEnoughInformation(mode: AnalysisMode): AnalysisResult {
  if (mode === "troubleshooter") {
    return {
      likelyIssueArea: "Insufficient retrieved documentation",
      likelyCause: "The retrieved sources do not provide enough relevant information to diagnose this issue.",
      checksToPerform: [],
      troubleshootingSteps: [],
      expectedBehavior: "The expected behavior is not established by the retrieved documentation.",
      relevantLimitations: [],
      sources: [],
    };
  }

  return {
    recommendedConfiguration: "Not enough information",
    relevantArea: "",
    trigger: "",
    baseObject: "",
    targetEntity: "",
    targetField: "",
    whyThisApproach:
      "The retrieved documentation does not contain enough information to choose a configuration approach.",
    suggestedLogic: "",
    configurationGuidance: [],
    explanation:
      "The available Employee Central documentation does not contain enough relevant information to answer this request.",
    importantConsiderations: [],
    validationSteps: [],
    sources: [],
  };
}

function normalizedCacheKey(query: string, mode: AnalysisMode): string {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  return JSON.stringify([answerSchemaVersion, normalizedQuery, mode]);
}

function readCache(key: string): AnalysisResult | undefined {
  const cached = analysisCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    analysisCache.delete(key);
    return undefined;
  }

  analysisCache.delete(key);
  analysisCache.set(key, cached);
  return cached.answer;
}

function writeCache(key: string, answer: AnalysisResult): void {
  const now = Date.now();
  for (const [cachedKey, cached] of analysisCache) {
    if (cached.expiresAt <= now) {
      analysisCache.delete(cachedKey);
    }
  }

  if (analysisCache.size >= maximumCachedResponses) {
    const oldestKey = analysisCache.keys().next().value;
    if (oldestKey) analysisCache.delete(oldestKey);
  }

  analysisCache.set(key, {
    answer,
    expiresAt: now + responseCacheTtlMs,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const query =
    typeof body === "object" && body !== null && "query" in body
      ? body.query
      : undefined;
  const mode =
    typeof body === "object" && body !== null && "mode" in body
      ? body.mode
      : undefined;

  if (typeof query !== "string" || query.trim().length === 0) {
    return Response.json(
      { error: "A non-empty query string is required." },
      { status: 400 },
    );
  }

  if (!isAnalysisMode(mode)) {
    return Response.json(
      { error: "Mode must be advisor or troubleshooter." },
      { status: 400 },
    );
  }

  const cacheKey = normalizedCacheKey(query, mode);
  const cachedAnswer = readCache(cacheKey);
  if (cachedAnswer) {
    return Response.json({ ...cachedAnswer, cached: true });
  }

  const rateLimit = checkAnalysisRateLimit(request);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many analysis requests. Please wait before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  let claimedUsageDate: string | null = null;
  try {
    claimedUsageDate = await claimDailyAnalysisSlot();
    if (claimedUsageDate === null) {
      return Response.json(
        { error: "demo_daily_limit", message: dailyAnalysisLimitMessage },
        { status: 429 },
      );
    }

    const chunks = await searchKnowledgeChunks(query.trim());
    if (chunks.length === 0) {
      const answer = notEnoughInformation(mode);
      writeCache(cacheKey, answer);
      return Response.json({ ...answer, cached: false });
    }

    const answer = await generateGroundedAnswer(query.trim(), mode, chunks);
    writeCache(cacheKey, answer);
    return Response.json({ ...answer, cached: false });
  } catch (error) {
    if (claimedUsageDate !== null) {
      try {
        await releaseDailyAnalysisSlot(claimedUsageDate);
      } catch (releaseError) {
        // Keep the reservation if Supabase cannot confirm its release.
        // Retrying a date-only decrement could release another request's slot.
        console.error("/api/analyze quota release failed", safeErrorDetails(releaseError));
      }
    }
    console.error("/api/analyze failed", safeErrorDetails(error));
    return Response.json(
      {
        error:
          "Unable to analyze the request right now. Please try again later.",
      },
      { status: 500 },
    );
  }
}
