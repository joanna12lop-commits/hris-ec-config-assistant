export const dailyAnalysisLimitMessage =
  "The live AI demo has reached its daily usage limit. Please try again tomorrow.";

export function analysisErrorMessage(payload: unknown, status: number): string {
  if (typeof payload !== "object" || payload === null || !("error" in payload)
    || typeof payload.error !== "string") {
    return "Analysis failed. Please try again.";
  }

  if (status === 429 && payload.error === "demo_daily_limit") {
    return dailyAnalysisLimitMessage;
  }

  return payload.error;
}
