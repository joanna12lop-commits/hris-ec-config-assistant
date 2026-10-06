import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const limitMessage = "The live AI demo has reached its daily usage limit. Please try again tomorrow.";

function loader(overrides, logs, environment = process.env) {
  const modules = new Map();
  const load = (file) => {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).exports;
    const compiledModule = { exports: {} };
    modules.set(file, compiledModule);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name === "server-only") return {};
      if (name in overrides) return overrides[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      return nodeRequire(name);
    };
    vm.runInThisContext(`(function(require,module,exports,console,process){${code}\n})`, { filename: file })(
      localRequire, compiledModule, compiledModule.exports,
      { error: (...args) => logs.push(args) }, { env: environment },
    );
    return compiledModule.exports;
  };
  return load;
}

function setup() {
  const state = {
    today: "2026-10-06", counts: new Map(), events: [], logs: [],
    claimError: false, malformedClaim: false, releaseError: false, rateAllowed: true,
    searchError: false, answerError: false, emptyRetrieval: false,
    onAnswer: null, onRelease: null,
  };
  // Models the RPC contract atomically. No production database is contacted.
  const supabaseAdmin = { rpc: async (name, args) => {
    if (name === "claim_daily_ai_request") {
      state.events.push("claim");
      if (state.claimError) return { data: null, error: { message: "Quota database unavailable" } };
      if (state.malformedClaim) return { data: 123, error: null };
      const count = state.counts.get(state.today) ?? 0;
      if (count >= 30) return { data: null, error: null };
      state.counts.set(state.today, count + 1);
      return { data: state.today, error: null };
    }
    assert.equal(name, "release_daily_ai_request");
    state.events.push(`release:${args.p_usage_date}`);
    if (state.onRelease) await state.onRelease();
    if (state.releaseError) return { data: null, error: { message: "Release unavailable" } };
    state.counts.set(args.p_usage_date, Math.max(0, (state.counts.get(args.p_usage_date) ?? 0) - 1));
    state.events.push("release-complete");
    return { data: null, error: null };
  } };
  const overrides = {
    "@/lib/supabase-admin": { supabaseAdmin },
    "@/lib/analysis-rate-limit": { checkAnalysisRateLimit: () => {
      state.events.push("rate");
      return { allowed: state.rateAllowed, retryAfterSeconds: 12 };
    } },
    "@/lib/knowledge-search": { searchKnowledgeChunks: async () => {
      state.events.push("embedding/retrieval");
      if (state.searchError) throw new Error("Embedding failed");
      return state.emptyRetrieval ? [] : [{ content: "Documented fact" }];
    } },
    "@/lib/openai": { generateGroundedAnswer: async (query, mode) => {
      state.events.push("chat");
      if (state.onAnswer) state.onAnswer();
      if (state.answerError) throw new Error("Chat completion failed");
      return mode === "troubleshooter"
        ? { likelyIssueArea: query, likelyCause: "Unconfirmed", checksToPerform: [], troubleshootingSteps: [], expectedBehavior: "Documented", relevantLimitations: [], sources: [] }
        : { recommendedConfiguration: query, relevantArea: "Documented", trigger: "", baseObject: "", targetEntity: "", targetField: "", whyThisApproach: "Documented", suggestedLogic: "", configurationGuidance: [], explanation: "Documented", importantConsiderations: [], validationSteps: [], sources: [] };
    } },
  };
  return { state, load: loader(overrides, state.logs), newInstance: () => loader(overrides, state.logs)("src/app/api/analyze/route.ts").POST };
}

const request = (query = "Workflow issue", mode = "troubleshooter") => new Request("http://localhost/api/analyze", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode }),
});

async function main() {
  {
    const { state, newInstance } = setup();
    const post = newInstance();
    const first = await post(request());
    assert.equal(first.status, 200);
    assert.equal((await first.json()).cached, false);
    assert.deepEqual(state.events, ["rate", "claim", "embedding/retrieval", "chat"]);
    state.counts.set(state.today, 30);
    state.claimError = true; // Cache must still work when quota storage is unavailable.
    state.rateAllowed = false;
    state.events.length = 0;
    const cached = await post(request("  WORKFLOW   issue  "));
    assert.equal(cached.status, 200);
    assert.equal((await cached.json()).cached, true);
    assert.deepEqual(state.events, []);
    assert.equal(state.counts.get(state.today), 30);
  }
  console.log("PASS: cache precedes all guards; cache hits consume no quota or paid calls");

  {
    const { state, newInstance } = setup();
    const instances = [newInstance(), newInstance()];
    const responses = await Promise.all(Array.from({ length: 75 }, (_, index) =>
      instances[index % 2](request(`Unique request ${index}`, index % 2 ? "advisor" : "troubleshooter")),
    ));
    assert.equal(responses.filter((response) => response.status === 200).length, 30);
    assert.equal(responses.filter((response) => response.status === 429).length, 45);
    assert.equal(state.counts.get(state.today), 30);
    assert.equal(state.events.filter((event) => event === "embedding/retrieval").length, 30);
    assert.equal(state.events.filter((event) => event === "chat").length, 30);
    assert.deepEqual(await responses.find((response) => response.status === 429).json(), {
      error: "demo_daily_limit", message: limitMessage,
    });
    // A fresh server instance still sees the persistent shared quota.
    const restarted = await newInstance()(request("After restart"));
    assert.equal(restarted.status, 429);
  }
  console.log("PASS: 75 concurrent requests across modes/instances admit only 30 using the RPC contract");

  for (const failure of ["searchError", "answerError"]) {
    const { state, newInstance } = setup();
    state[failure] = true;
    const response = await newInstance()(request());
    assert.equal(response.status, 500);
    assert.equal(state.counts.get(state.today), 0);
    assert.equal(state.events.filter((event) => event.startsWith("release:")).length, 1);
    assert.equal(state.events.at(-1), "release-complete");
  }
  {
    const { state, newInstance } = setup();
    state.answerError = true;
    state.counts.set("2026-10-06", 5);
    state.onAnswer = () => {
      state.today = "2026-10-07";
      state.counts.set(state.today, 7);
    };
    assert.equal((await newInstance()(request())).status, 500);
    assert.equal(state.counts.get("2026-10-06"), 5);
    assert.equal(state.counts.get("2026-10-07"), 7);
    assert(state.events.includes("release:2026-10-06"));
  }
  {
    const { state, newInstance } = setup();
    state.answerError = true;
    let startRelease;
    let finishRelease;
    const started = new Promise((resolve) => { startRelease = resolve; });
    const gate = new Promise((resolve) => { finishRelease = resolve; });
    state.onRelease = () => { startRelease(); return gate; };
    let responseReturned = false;
    const pending = newInstance()(request()).then((response) => { responseReturned = true; return response; });
    await started;
    assert.equal(responseReturned, false);
    finishRelease();
    assert.equal((await pending).status, 500);
    assert.equal(state.counts.get(state.today), 0);
  }
  console.log("PASS: embedding/chat failures await exactly one release against the original UTC date");

  for (const failure of ["claimError", "malformedClaim"]) {
    const { state, newInstance } = setup();
    state[failure] = true;
    assert.equal((await newInstance()(request())).status, 500);
    assert.deepEqual(state.events, ["rate", "claim"]);
  }
  {
    const { state, newInstance } = setup();
    state.answerError = true;
    state.releaseError = true;
    assert.equal((await newInstance()(request())).status, 500);
    assert.equal(state.counts.get(state.today), 1);
    assert.equal(state.events.filter((event) => event.startsWith("release:")).length, 1);
    assert(state.logs.some((entry) => entry[0] === "/api/analyze quota release failed"));
  }
  {
    const { state, newInstance } = setup();
    state.emptyRetrieval = true;
    assert.equal((await newInstance()(request())).status, 200);
    assert.equal(state.counts.get(state.today), 1);
    assert(!state.events.includes("chat"));
    state.today = "2026-10-07";
    assert.equal((await newInstance()(request("New UTC day"))).status, 200);
    assert.equal(state.counts.get(state.today), 1);
  }
  {
    const { state, newInstance } = setup();
    state.rateAllowed = false;
    const post = newInstance();
    const denied = await post(request());
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("Retry-After"), "12");
    assert.deepEqual(state.events, ["rate"]);
    state.events.length = 0;
    assert.equal((await post(request("", "advisor"))).status, 400);
    assert.deepEqual(state.events, []);
  }
  console.log("PASS: quota errors fail closed; release errors retain capacity; UTC rollover and existing guards preserved");

  {
    const load = loader({}, []);
    const { analysisErrorMessage } = load("src/lib/analysis-errors.ts");
    assert.equal(analysisErrorMessage({ error: "demo_daily_limit", message: "Ignored" }, 429), limitMessage);
    assert.equal(analysisErrorMessage({ error: "Existing rate-limit message" }, 429), "Existing rate-limit message");
    assert.equal(analysisErrorMessage(null, 500), "Analysis failed. Please try again.");
  }
  {
    let paidCalls = 0;
    const load = loader({
      "@/lib/seed-knowledge": { seedKnowledgeChunks: async () => { paidCalls++; } },
      "@/lib/knowledge-search": { searchKnowledgeChunks: async () => { paidCalls++; } },
      "@/lib/supabase-admin": { supabaseAdmin: {} },
    }, [], { NODE_ENV: "production" });
    for (const name of ["test-search", "seed-knowledge"]) {
      assert.equal((await load(`src/app/api/${name}/route.ts`).POST(request())).status, 404);
    }
    assert.equal(paidCalls, 0);
  }
  console.log("PASS: frontend displays the exact daily-limit message; production maintenance routes cannot bypass protection");
}

await main();
