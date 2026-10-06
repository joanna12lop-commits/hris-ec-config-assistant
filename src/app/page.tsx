"use client";

import { useRef, useState, useSyncExternalStore } from "react";

type Mode = "advisor" | "troubleshooter";
type AdvisorResponse = {
  recommendedConfiguration: string;
  relevantArea: string;
  trigger: string;
  baseObject: string;
  targetEntity: string;
  targetField: string;
  whyThisApproach: string;
  suggestedLogic: string;
  configurationGuidance: string[];
  explanation: string;
  importantConsiderations: string[];
  validationSteps: string[];
  sources: { title: string; section: string }[];
  cached: boolean;
};

type TroubleshootingResponse = {
  likelyIssueArea: string;
  likelyCause: string;
  checksToPerform: string[];
  troubleshootingSteps: string[];
  expectedBehavior: string;
  relevantLimitations: string[];
  sources: { title: string; section: string }[];
  cached: boolean;
};

type AnalysisResult =
  | { mode: "advisor"; answer: AdvisorResponse }
  | { mode: "troubleshooter"; answer: TroubleshootingResponse };

const unspecified = "Not specified in retrieved documentation";
const requestLimit = 3;
const requestCountStorageKey = "hris-ec-live-analysis-count";
const limitReachedMessage =
  "Demo limit reached. This portfolio project limits live AI requests to control API costs.";
const requestCountChangedEvent = "hris-ec-live-analysis-count-changed";

function getSessionRequestCount(): number {
  try {
    const count = Number(window.sessionStorage.getItem(requestCountStorageKey));
    return Number.isInteger(count) && count >= 0
      ? Math.min(count, requestLimit)
      : 0;
  } catch {
    return 0;
  }
}

function subscribeToSessionRequestCount(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(requestCountChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(requestCountChangedEvent, onChange);
  };
}

const examples = [
  "FTE change should update a recurring pay component",
  "Salary increase above 10% should require approval",
  "Job Classification change should update Job Title",
];

function isSourceArray(
  value: unknown,
): value is { title: string; section: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (source) =>
        typeof source === "object" &&
        source !== null &&
        !Array.isArray(source) &&
        typeof (source as Record<string, unknown>).title === "string" &&
        typeof (source as Record<string, unknown>).section === "string",
    )
  );
}

function isAdvisorResponse(value: unknown): value is AdvisorResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.recommendedConfiguration === "string" &&
    typeof response.relevantArea === "string" &&
    typeof response.trigger === "string" &&
    typeof response.baseObject === "string" &&
    typeof response.targetEntity === "string" &&
    typeof response.targetField === "string" &&
    typeof response.whyThisApproach === "string" &&
    typeof response.suggestedLogic === "string" &&
    Array.isArray(response.configurationGuidance) &&
    response.configurationGuidance.every((item) => typeof item === "string") &&
    typeof response.explanation === "string" &&
    typeof response.cached === "boolean" &&
    Array.isArray(response.importantConsiderations) &&
    response.importantConsiderations.every(
      (item) => typeof item === "string",
    ) &&
    Array.isArray(response.validationSteps) &&
    response.validationSteps.every((item) => typeof item === "string") &&
    isSourceArray(response.sources)
  );
}

function isTroubleshootingResponse(value: unknown): value is TroubleshootingResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.likelyIssueArea === "string" &&
    typeof response.likelyCause === "string" &&
    Array.isArray(response.checksToPerform) &&
    response.checksToPerform.every((item) => typeof item === "string") &&
    Array.isArray(response.troubleshootingSteps) &&
    response.troubleshootingSteps.every((item) => typeof item === "string") &&
    typeof response.expectedBehavior === "string" &&
    Array.isArray(response.relevantLimitations) &&
    response.relevantLimitations.every((item) => typeof item === "string") &&
    typeof response.cached === "boolean" &&
    isSourceArray(response.sources)
  );
}
function ModeSelector({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  return (
    <div
      className="mode-selector"
      role="group"
      aria-label="Choose a guidance mode"
    >
      <button
        className={`mode-option${mode === "advisor" ? " is-active" : ""}`}
        type="button"
        aria-pressed={mode === "advisor"}
        onClick={() => onChange("advisor")}
      >
        <span>Configuration Advisor</span>
      </button>
      <button
        className={`mode-option${mode === "troubleshooter" ? " is-active" : ""}`}
        type="button"
        aria-pressed={mode === "troubleshooter"}
        onClick={() => onChange("troubleshooter")}
      >
        <span>Troubleshooter</span>
      </button>
    </div>
  );
}

function ResultCard({ result, mode }: { result: AnalysisResult | null; mode: Mode }) {
  const isTroubleshooter = mode === "troubleshooter";
  const troubleshooting = result?.mode === "troubleshooter"
    ? result.answer
    : null;
  const advisor = result?.mode === "advisor" ? result.answer : null;
  const sources = result?.answer.sources ?? [];

  return (
    <section className="result-panel" aria-labelledby="result-title">
      <div className="result-topline">
        <span className="result-kicker">
          {isTroubleshooter ? "TROUBLESHOOTING GUIDANCE" : "Configuration guidance"}
        </span>
        <span className="preview-status">
          <span />
          {result ? "Retrieved guidance" : "Awaiting request"}
        </span>
      </div>

      {isTroubleshooter ? (
        <>
          <h2 className="result-title" id="result-title">
            Troubleshooting guidance
          </h2>

          <div className="summary-banner">
            <p className="field-label">Likely issue area</p>
            <p>{troubleshooting?.likelyIssueArea || unspecified}</p>
          </div>

          <div className="result-section">
            <p className="field-label">What may be happening</p>
            <p className="result-body-copy">
              {troubleshooting?.likelyCause || "The retrieved sources do not identify a likely cause."}
            </p>
          </div>

          <TroubleshootingList
            title="Checks to perform"
            items={troubleshooting?.checksToPerform ?? []}
            emptyText="The retrieved sources do not support specific checks for this issue."
          />
          <TroubleshootingList
            title="Troubleshooting steps"
            items={troubleshooting?.troubleshootingSteps ?? []}
            emptyText="The retrieved sources do not provide specific troubleshooting steps."
          />

          <div className="result-section">
            <p className="field-label">Expected behavior</p>
            <p className="result-body-copy">
              {troubleshooting?.expectedBehavior || "Expected behavior is not established by the retrieved sources."}
            </p>
          </div>

          <TroubleshootingList
            title="Relevant limitations"
            items={troubleshooting?.relevantLimitations ?? []}
            emptyText="No directly relevant limitations were identified in the retrieved sources."
          />
        </>
      ) : (
        <>
          <h2 className="result-title" id="result-title">
            Recommended approach
          </h2>

          <div className="summary-banner">
            <p className="field-label">Recommended configuration</p>
            <p>{advisor?.recommendedConfiguration ?? "Run an analysis to see a recommendation."}</p>
          </div>

          <div className="result-facts">
            <div className="result-fact">
              <p className="field-label">Recommended Configuration</p>
              <p>{advisor?.recommendedConfiguration ?? "-"}</p>
            </div>
            <div className="result-fact">
              <p className="field-label">Relevant Area</p>
              <p>{advisor?.relevantArea || (advisor ? unspecified : "-")}</p>
            </div>
            <div className="result-fact">
              <p className="field-label">Trigger</p>
              <p>{advisor?.trigger ? <code>{advisor.trigger}</code> : advisor ? unspecified : "-"}</p>
            </div>
            <div className="result-fact">
              <p className="field-label">Base Object</p>
              <p>{advisor?.baseObject ? <code>{advisor.baseObject}</code> : advisor ? unspecified : "-"}</p>
            </div>
          </div>

          <div className="result-section logic-section">
            <p className="field-label">Suggested Logic</p>
            <pre className="logic-copy"><code>{advisor?.suggestedLogic || (advisor ? unspecified : "-")}</code></pre>
          </div>

          <div className="result-section">
            <p className="field-label">Why this approach</p>
            <p className="result-body-copy">{advisor?.whyThisApproach ?? "Run an analysis to see why a configuration approach fits."}</p>
          </div>

          {advisor && (advisor.targetField || advisor.targetEntity) && (
            <div className="result-section">
              <p className="field-label">{advisor.targetField ? "Target Field" : "Target Entity"}</p>
              <p className="result-body-copy">{advisor.targetField || advisor.targetEntity}</p>
            </div>
          )}

          <div className="result-section">
            <p className="field-label">Configuration Guidance</p>
            {advisor?.configurationGuidance.length ? (
              <ol className="guidance-list">
                {advisor.configurationGuidance.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
              </ol>
            ) : (
              <p className="result-empty-note">{advisor ? "The retrieved documentation is insufficient for detailed configuration steps." : "-"}</p>
            )}
          </div>

          <div className="result-section explanation-section">
            <p className="field-label">Explanation</p>
            <p>{advisor?.explanation ?? "Run an analysis to see source-grounded guidance."}</p>
          </div>

          <div className="considerations-section">
            <p className="field-label">Important Considerations</p>
            <ul>{advisor?.importantConsiderations.map((item) => <li key={item}>{item}</li>)}</ul>
            {advisor && advisor.importantConsiderations.length === 0 && (
              <p className="result-empty-note">No additional considerations were identified in retrieved documentation.</p>
            )}
          </div>

          <div className="result-section">
            <p className="field-label">Validation / Testing</p>
            {advisor?.validationSteps.length ? (
              <ol className="guidance-list">
                {advisor.validationSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
              </ol>
            ) : (
              <p className="result-empty-note">{advisor ? "No validation steps were supported by the retrieved documentation." : "-"}</p>
            )}
          </div>
        </>
      )}

      <div className="sources-section">
        <p className="field-label">Sources</p>
        {sources.map((source) => (
          <details
            className="source-item"
            key={`${source.title}-${source.section}`}
            open
          >
            <summary>{source.title}</summary>
            <p>{source.section}</p>
          </details>
        ))}
        {result && sources.length === 0 && (
          <p className="result-empty-note">No sources were retrieved.</p>
        )}
      </div>
    </section>
  );
}

function TroubleshootingList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="result-section">
      <p className="field-label">{title}</p>
      {items.length > 0 ? (
        <ol className="guidance-list">
          {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ol>
      ) : (
        <p className="result-empty-note">{emptyText}</p>
      )}
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("advisor");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const successfulLiveRequests = useSyncExternalStore(
    subscribeToSessionRequestCount,
    getSessionRequestCount,
    () => 0,
  );
  const requestInFlight = useRef(false);
  const isAdvisor = mode === "advisor";

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setPrompt("");
    setError("");
    setResult(null);
  }

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;

    let usedCount = successfulLiveRequests;
    try {
      const storedCount = Number(
        window.sessionStorage.getItem(requestCountStorageKey),
      );
      if (Number.isInteger(storedCount) && storedCount >= 0) {
        usedCount = Math.min(storedCount, requestLimit);
      }
    } catch {
      // Keep the in-memory count if browser storage is unavailable.
    }

    if (usedCount >= requestLimit) {
      setError(limitReachedMessage);
      return;
    }

    requestInFlight.current = true;
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: prompt, mode }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Analysis failed. Please try again.";
        throw new Error(message);
      }

      if (
        (mode === "advisor" && !isAdvisorResponse(payload)) ||
        (mode === "troubleshooter" && !isTroubleshootingResponse(payload))
      ) {
        throw new Error(
          "The analysis response was incomplete. Please try again.",
        );
      }

      setResult(
        mode === "advisor"
          ? { mode, answer: payload as AdvisorResponse }
          : { mode, answer: payload as TroubleshootingResponse },
      );
      const answer = payload as AdvisorResponse | TroubleshootingResponse;
      if (!answer.cached) {
        const nextCount = Math.min(usedCount + 1, requestLimit);
        try {
          window.sessionStorage.setItem(
            requestCountStorageKey,
            String(nextCount),
          );
          window.dispatchEvent(new Event(requestCountChangedEvent));
        } catch {
          // The limit remains best-effort if the browser blocks session storage.
        }
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to analyze the request. Please try again.",
      );
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="page-width header-content">
          <a
            className="brand"
            href="#top"
            aria-label="HRIS EC Configuration Assistant home"
          >
            <span className="brand-monogram">HRIS EC</span>
          </a>
          <span className="header-note">
            <span className="header-note-dot" />
            Independent project
          </span>
        </div>
      </header>

      <main className="page-width" id="top">
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-copy">
            <p className="eyebrow">
              <span />
              Employee Central guidance
            </p>
            <h1 id="page-title">HRIS EC Configuration Assistant</h1>
            <p className="intro-subtitle">
              Describe a business requirement or issue. Get clear, structured
              guidance for your Employee Central configuration.
            </p>
          </div>
        </section>

        <section className="request-panel" aria-label="Configuration request">
          <ModeSelector mode={mode} onChange={selectMode} />

          <form onSubmit={analyze}>
            <label className="prompt-label" htmlFor="request-prompt">
              {isAdvisor
                ? "What would you like to configure?"
                : "What configuration issue are you troubleshooting?"}
            </label>
            <textarea
              id="request-prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError("");
              }}
              placeholder={
                isAdvisor
                  ? "Create a rule to default probation period to 90 days for regular employees when the field is blank."
                  : "The workflow did not trigger after a promotion."
              }
              required
            />

            {isAdvisor && (
              <div className="examples-block">
                <p className="field-label">Try an example</p>
                <div className="example-list">
                  {examples.map((example) => (
                    <button
                      className="example-button"
                      key={example}
                      type="button"
                      onClick={() => {
                        setPrompt(example);
                        setError("");
                      }}
                    >
                      <span aria-hidden="true">+</span>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              className="analyze-button"
              type="submit"
              disabled={isLoading}
            >
              <span>{isLoading ? "Analyzing..." : "Analyze requirement"}</span>
              <span className="analyze-arrow" aria-hidden="true">
                →
              </span>
            </button>
            <p className="request-limit-note" aria-live="polite">
              Live AI demo: {Math.max(0, requestLimit - successfulLiveRequests)}{" "}
              of {requestLimit} requests remaining
            </p>
            <p
              className="submit-notice"
              aria-live="polite"
              role={error ? "alert" : undefined}
            >
              {error}
            </p>
          </form>
        </section>

        <ResultCard result={result} mode={mode} />
      </main>

      <footer className="site-footer">
        <div className="page-width footer-content">
          <p>
            This is an independent educational portfolio project and is not
            affiliated with or endorsed by SAP SE.
          </p>
        </div>
      </footer>
    </div>
  );
}
