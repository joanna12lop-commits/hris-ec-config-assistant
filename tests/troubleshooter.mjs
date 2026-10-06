import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);

// Exercise the actual TypeScript modules without a Next server or new dependencies.
function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const source = fs.readFileSync(file, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }}).outputText;
    const localRequire = (name) => {
      if (name === "server-only") return {};
      if (name in overrides) return overrides[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      return nodeRequire(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(localRequire, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  return load;
}

const fields = ["likelyIssueArea", "likelyCause", "checksToPerform", "troubleshootingSteps", "expectedBehavior", "relevantLimitations", "sources"].sort();
function checkSchema(answer) {
  assert.deepEqual(Object.keys(answer).sort(), fields);
  for (const key of ["likelyIssueArea", "likelyCause", "expectedBehavior"]) assert.equal(typeof answer[key], "string");
  for (const key of ["checksToPerform", "troubleshootingSteps", "relevantLimitations"]) assert(answer[key].every(item => typeof item === "string"));
}
function checkConciseGuidance(answer) {
  for (const items of [answer.checksToPerform, answer.troubleshootingSteps]) {
    assert.equal(new Set(items).size, items.length);
    for (const item of items) {
      assert(item.length <= 250, `Guidance is too long: ${item}`);
      assert((item.match(/[.!?](?:\s|$)/g) ?? []).length <= 2);
      assert(!/Compare your existing configuration|Documentation states:|Validate this behavior against/.test(item));
    }
  }
}
function checkReadableCause(answer) {
  assert(answer.likelyCause.length <= 220);
  assert((answer.likelyCause.match(/[.!?](?:\s|$)/g) ?? []).length <= 2);
  assert(!/A mismatch with|Documentation states:/.test(answer.likelyCause));
  assert(/may|still|before|not enough|does not give enough/.test(answer.likelyCause));
}
const dataset = JSON.parse(fs.readFileSync("data/ec_rag_chunks_cleaned.json", "utf8"));
function chunk(title) {
  const item = dataset.find(item => item.title === title);
  assert(item, `Missing knowledge fixture: ${title}`);
  return { source_title: item.title, section: item.source_section,
    content: [`Source summary: ${item.source_summary}`, `Supported use cases: ${item.supported_use_cases.join("; ")}`, `Trigger event: ${item.trigger_event}`, `Base object/entity: ${item.base_object_entity}`, `Configuration logic: ${item.configuration_logic}`, `Important limitations: ${item.important_limitations.join("; ")}`].join("\n\n") };
}
function cite(item) { return { title: item.source_title, section: item.section }; }
function evidence(step, item) { return { step, evidence: item.content.split("\n")[0].replace("Source summary: ", "") }; }

async function main() {
  if (process.argv.includes("--live")) {
    nodeRequire("@next/env").loadEnvConfig(process.cwd());
    const RealOpenAI = nodeRequire("openai").default;
    class TraceOpenAI extends RealOpenAI {
      constructor(options) {
        super(options);
        const create = this.chat.completions.create.bind(this.chat.completions);
        this.chat.completions.create = async (...args) => {
          const response = await create(...args);
          if (process.argv.includes("--trace")) console.log(response.choices[0].message.content);
          return response;
        };
      }
    }
    const load = loader({ openai: TraceOpenAI });
    const { searchKnowledgeChunks } = load("src/lib/knowledge-search.ts");
    const { generateGroundedAnswer } = load("src/lib/openai.ts");
    for (const [query, mode] of [
      ["the workflow didn't trigger after promotion", "troubleshooter"],
      ["Recurring pay component did not update after FTE change", "troubleshooter"],
      ["FTE change should update a recurring pay component", "advisor"],
      ["Job Classification change should update Job Title", "advisor"],
      ["Future Job Information records did not update after a correction in History UI", "troubleshooter"],
    ]) {
      const retrieved = await searchKnowledgeChunks(query);
      assert(retrieved.length > 0, "Live retrieval returned no documentation");
      const answer = await generateGroundedAnswer(query, mode, retrieved);
      console.log(JSON.stringify({ query, mode, retrieved: retrieved.map(cite), answer }, null, 2));
      if (mode === "advisor") {
        assert(answer.configurationGuidance.length > 0);
        assert(answer.sources.length > 0);
        if (query.includes("FTE")) {
          assert.equal(answer.baseObject, "Job Information");
          assert.equal(answer.targetEntity, "Recurring Pay Components");
          assert.match(answer.configurationGuidance.join(" "), /UI, API, and import/);
          assert.match(answer.whyThisApproach, /Job Information.*Recurring Pay Components/);
        } else {
          assert.equal(answer.trigger, "onChange");
          assert.match(answer.configurationGuidance.join(" "), /Job Classification|Job Information Model/);
        }
        continue;
      }
      checkSchema(answer);
      checkConciseGuidance(answer);
      checkReadableCause(answer);
      assert(answer.checksToPerform.length > 0);
      assert(answer.troubleshootingSteps.length > 0);
      assert(answer.sources.length > 0);
      assert(!answer.expectedBehavior.includes("not established"));
      if (query.includes("workflow")) {
        assert(answer.checksToPerform.length >= 3 && answer.checksToPerform.length <= 5);
        const diagnostics = JSON.stringify(answer);
        assert.match(diagnostics, /onSave/);
        assert.match(diagnostics, /conditions/i);
        assert.match(diagnostics, /does not confirm support for this exact transaction/i);
        assert.match(diagnostics, /assign the configured workflow/i);
        assert.match(diagnostics, /Event Reason Derivation/i);
        assert(!diagnostics.includes("Propagation stops"));
        assert(!diagnostics.includes("salary-increase percentage"));
      } else if (query.includes("FTE")) {
        assert.match(answer.checksToPerform.join(" "), /UI, API, and import/);
        assert.match(answer.checksToPerform.join(" "), /Job Information.*Recurring Pay Components/);
      } else {
        assert.match(JSON.stringify(answer), /Corrections.*do not forward propagate/i);
      }
    }
    return;
  }

  let generated;
  let request;
  class MockOpenAI {
    chat = { completions: { create: async input => {
      request = input;
      return { choices: [{ message: { content: JSON.stringify(generated) } }] };
    } } };
  }
  process.env.OPENAI_API_KEY ||= "test-only";
  const { generateGroundedAnswer } = loader({ openai: MockOpenAI })("src/lib/openai.ts");
  const workflow = chunk("Workflow Derivation Overview");
  const order = chunk("Workflow Derivation Execution Order");
  generated = {
    likelyIssueArea: evidence("Workflow Derivation", workflow),
    likelyCause: evidence("The configured approval conditions may not have matched the changed data; the documentation does not establish the actual promotion condition.", workflow),
    checksToPerform: [
      { step: "Compare the existing Trigger Workflows registration with onSave. A different event does not match the documented registration restriction.", evidence: "Trigger Workflows scenario rules can only be registered for onSave." },
      evidence("Compare changed data with the configured rule conditions and verify whether this data change is supported. The retrieved overview does not establish promotion-specific support.", workflow),
      { step: "Check whether matching approval conditions assign the configured workflow. Without assignment, the documented rule outcome is absent.", evidence: "IF approval conditions are met THEN assign the configured workflow." },
      evidence("Where Event Reason Derivation applies, compare workflow conditions with the values derived earlier in the save sequence.", order),
    ],
    troubleshootingSteps: [evidence("First compare the saved change and existing conditions; a mismatch is a possible reason the workflow was not selected.", workflow), evidence("Then investigate the values available after earlier rules execute, where Event Reason Derivation applies.", order)],
    expectedBehavior: { step: "When approval conditions are met, the rule assigns the configured workflow.", evidence: "IF approval conditions are met THEN assign the configured workflow." },
    relevantLimitations: [{ step: "The exact sequence depends on which entities are part of the transaction.", evidence: "The exact sequence depends on which entities are part of the transaction." }],
    sources: [cite(workflow), cite(order)],
  };
  const workflowAnswer = await generateGroundedAnswer("the workflow didn't trigger after promotion", "troubleshooter", [workflow, order]);
  checkSchema(workflowAnswer);
  checkConciseGuidance(workflowAnswer);
  checkReadableCause(workflowAnswer);
  assert.match(workflowAnswer.likelyCause, /workflow conditions may not have been met/);
  assert.equal(workflowAnswer.checksToPerform.length, 5);
  assert.equal(workflowAnswer.troubleshootingSteps.length, 3);
  assert.match(request.messages[0].content, /diagnose likely causes/);
  assert.match(request.messages[0].content, /Do not assume promotion is supported/);
  console.log("PASS: workflow diagnostic schema, trigger/conditions/support/assignment/order checks");

  // Multiple sources and differently worded excerpts must not duplicate a check.
  const overlapping = { ...workflow, source_title: "Workflow Derivation Registration", section: "Duplicate supporting section" };
  generated.sources.push(cite(overlapping));
  generated.checksToPerform.push({ step: "Confirm the trigger again", evidence: "The Trigger Workflows scenario is the dedicated scenario and can only be registered as onSave in Manage Business Configuration." });
  const merged = await generateGroundedAnswer("the workflow didn't trigger after promotion", "troubleshooter", [workflow, order, overlapping]);
  assert.deepEqual(merged.checksToPerform, workflowAnswer.checksToPerform);
  assert.deepEqual(merged.troubleshootingSteps, workflowAnswer.troubleshootingSteps);

  // A documented trigger alone must not manufacture conditions, assignment,
  // supported-change or order checks from an ungrounded generated instruction.
  const triggerOnly = { ...workflow, content: "Source summary: Trigger Workflows scenario rules can only be registered for onSave." };
  generated.sources = [cite(workflow)];
  const partial = await generateGroundedAnswer("the workflow didn't trigger after promotion", "troubleshooter", [triggerOnly]);
  assert.equal(partial.checksToPerform.length, 1);
  assert.match(partial.checksToPerform[0], /registered for onSave/);
  assert(!JSON.stringify(partial.checksToPerform).includes("conditions"));
  assert.match(partial.likelyCause, /cause is still unclear/);
  console.log("PASS: overlapping source evidence merged; missing facts do not create extra checks");

  const propagation = chunk("Forward Propagation in Job Information");
  generated = {
    likelyIssueArea: evidence("Forward Propagation in Job Information", propagation),
    likelyCause: { step: "A History UI correction may explain the unchanged future records: corrections do not forward propagate.", evidence: "Corrections and most deletions in History UI do not forward propagate." },
    checksToPerform: [{ step: "Check whether the change was a correction in History UI. A correction matches the documented exception to forward propagation.", evidence: "Corrections and most deletions in History UI do not forward propagate." }],
    troubleshootingSteps: [evidence("Compare future effective-dated field values with the original value; a different original value marks where propagation stops.", propagation)],
    expectedBehavior: evidence("Forward propagation copies a changed field value to future records until a different original value is encountered.", propagation),
    relevantLimitations: [{ step: "Rules are not triggered for propagated future records.", evidence: "Rules are not triggered for propagated future records." }], sources: [cite(propagation)],
  };
  const generalAnswer = await generateGroundedAnswer("Future Job Information records did not update after a correction in History UI", "troubleshooter", [propagation]);
  checkSchema(generalAnswer);
  checkConciseGuidance(generalAnswer);
  checkReadableCause(generalAnswer);
  assert.match(generalAnswer.likelyCause, /History UI correction may explain/);
  assert(generalAnswer.checksToPerform.length >= 1);
  assert(!JSON.stringify(generalAnswer).includes("Workflow"));
  console.log("PASS: non-workflow diagnosis using existing forward-propagation documentation");

  const incidentalOverview = chunk("Event Reason Derivation Overview");
  generated.sources.push(cite(incidentalOverview));
  generated.likelyIssueArea = evidence("Event Reason Derivation", incidentalOverview);
  const focusedCorrection = await generateGroundedAnswer("Future Job Information records did not update after a correction in History UI", "troubleshooter", [propagation, incidentalOverview]);
  assert.match(focusedCorrection.likelyIssueArea, /Forward Propagation/);
  assert.match(focusedCorrection.checksToPerform.join(" "), /correction in History UI/);
  assert.equal(focusedCorrection.sources.length, 2);
  generated.sources = [cite(propagation)];
  generated.likelyIssueArea = evidence("Forward Propagation in Job Information", propagation);

  const originalCause = generated.likelyCause;
  generated.likelyCause = { step: "Unverified explanation", evidence: "Rules are not triggered for propagated future records." };
  const unfamiliarCause = await generateGroundedAnswer("future-record issue", "troubleshooter", [propagation]);
  checkReadableCause(unfamiliarCause);
  assert.match(unfamiliarCause.likelyCause, /cause is still unclear/);
  const withoutCause = ({ likelyCause, ...rest }) => { void likelyCause; return rest; };
  assert.deepEqual(withoutCause(unfamiliarCause), withoutCause(generalAnswer));
  generated.likelyCause = originalCause;
  console.log("PASS: plain-English causes stay cautious; unfamiliar evidence adds no invented explanation");

  generated.checksToPerform.push({ step: "Open an invented Admin Center diagnostic log.", evidence: "This excerpt is absent from retrieved sources." }, "Unsupported plain string");
  generated.likelyCause = { step: "Invented cause", evidence: "Unsupported cause evidence" };
  generated.expectedBehavior = null;
  generated.sources.push({ title: "Invented manual", section: "Invented tool" });
  const sanitized = await generateGroundedAnswer("correction issue", "troubleshooter", [propagation]);
  assert(!JSON.stringify(sanitized).includes("invented Admin Center"));
  assert(!sanitized.likelyCause.includes("Invented cause"));
  assert(sanitized.expectedBehavior.includes("Propagate the changed value"));
  assert.equal(sanitized.sources.length, 1);
  generated.sources = [];
  const insufficient = await generateGroundedAnswer("unknown issue", "troubleshooter", [propagation]);
  assert.equal(insufficient.checksToPerform.length, 0);
  assert.match(insufficient.likelyCause, /not provide enough/);
  console.log("PASS: unsupported diagnostics removed; insufficient evidence explicitly reported");

  const crossEntity = chunk("Cross-Entity Rules Overview");
  generated = {
    likelyIssueArea: evidence("Cross-Entity Rules", crossEntity),
    likelyCause: evidence("Possible source or target mismatch", crossEntity),
    checksToPerform: [], troubleshootingSteps: [], expectedBehavior: null,
    relevantLimitations: [], sources: [cite(crossEntity)],
  };
  const crossTroubleshooting = await generateGroundedAnswer("Recurring pay component did not update after FTE change", "troubleshooter", [crossEntity]);
  checkSchema(crossTroubleshooting);
  checkConciseGuidance(crossTroubleshooting);
  assert.match(crossTroubleshooting.checksToPerform.join(" "), /UI, API, and import/);
  assert.match(crossTroubleshooting.checksToPerform.join(" "), /Job Information.*Recurring Pay Components/);
  assert.match(crossTroubleshooting.checksToPerform.join(" "), /both entities.*MSS/);
  assert(!crossTroubleshooting.relevantLimitations.join(" ").includes("onSave"));
  const incompleteCrossEntity = { ...crossEntity, content: crossEntity.content.replace("onSave is supported for UI, API and imports when the source is modified.", "") };
  const unconfirmed = await generateGroundedAnswer("Recurring pay component did not update after FTE change", "troubleshooter", [incompleteCrossEntity]);
  assert(unconfirmed.checksToPerform.includes("The retrieved documentation does not confirm support for this exact transaction."));
  assert(!unconfirmed.checksToPerform.join(" ").includes("UI, API, and import"));

  generated = {
    recommendedConfiguration: "Cross-Entity Business Rule", baseObject: "Job Information",
    targetEntity: "Recurring Pay Components", trigger: "", targetField: "",
    whyThisApproach: "Generic supported scenario", configurationGuidance: [], validationSteps: [],
    importantConsiderations: ["The source element must be the rule base object.", "onSave is supported for UI, API and imports when the source is modified."],
    sources: [cite(crossEntity)],
  };
  const crossAdvisor = await generateGroundedAnswer("FTE change should update a recurring pay component", "advisor", [crossEntity]);
  assert.equal(crossAdvisor.trigger, "onSave");
  assert.match(crossAdvisor.whyThisApproach, /Job Information.*Recurring Pay Components/);
  assert.match(crossAdvisor.configurationGuidance.join(" "), /UI, API, and import/);
  assert.match(crossAdvisor.explanation, /does not provide the exact setup/);
  assert.match(crossAdvisor.validationSteps.join(" "), /Change FTE in Job Information and save/);
  assert.equal(crossAdvisor.importantConsiderations.length, 0);
  assert(!JSON.stringify(crossAdvisor).includes("Confirm the applicable supported scenario"));
  assert.match(request.messages[0].content, /Do not repeat the same documented fact across sections/);
  const jobTitle = chunk("Business-Rule Defaulting from Job Classification to Job Title");
  generated = { ...generated, recommendedConfiguration: "onChange Business Rule", baseObject: "Job Information Model", targetEntity: "", targetField: "Job Title", sources: [cite(jobTitle)] };
  const jobTitleAdvisor = await generateGroundedAnswer("Job Classification change should update Job Title", "advisor", [jobTitle]);
  assert.match(jobTitleAdvisor.configurationGuidance.join(" "), /Trigger onChange Rules for HRIS Elements/);
  assert.match(jobTitleAdvisor.configurationGuidance.join(" "), /Assign the rule to the Job Classification field/);
  assert.equal(jobTitleAdvisor.validationSteps.length, 1);
  assert(!jobTitleAdvisor.validationSteps.join(" ").includes("save"));
  console.log("PASS: both modes name documented entities and processing channels; missing transaction support is explicit");

  // Answer wording may change, but the source-selection rules must remain intact.
  const baseline = execFileSync("git", ["show", "HEAD:src/lib/openai.ts"], { encoding: "utf8" }).replace(/\r\n/g, "\n");
  const current = fs.readFileSync("src/lib/openai.ts", "utf8").replace(/\r\n/g, "\n");
  const baselineAdvisor = baseline.slice(baseline.indexOf('async function generateGroundedConfigurationAnswer') >= 0
    ? baseline.indexOf('async function generateGroundedConfigurationAnswer')
    : baseline.indexOf('export async function generateGroundedAnswer'));
  const sourceSelection = (source) => source.slice(source.indexOf('  const chunksByCitation'), source.indexOf('  if (selectedChunks.length === 0)'));
  const currentAdvisor = current.slice(current.indexOf('async function generateGroundedConfigurationAnswer'));
  assert.equal(sourceSelection(currentAdvisor), sourceSelection(baselineAdvisor));
  console.log("PASS: Advisor source filtering unchanged");

  // Render actual result-card JSX, including the empty Troubleshooter state.
  const page = fs.readFileSync("src/app/page.tsx", "utf8") + '\nexport { ResultCard };';
  const code = ts.transpileModule(page, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const compiledModule = { exports: {} };
  const pageRequire = (name) => name.startsWith("@/")
    ? loader()(`src/${name.slice(2)}.ts`) : nodeRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(pageRequire, compiledModule, compiledModule.exports);
  const React = nodeRequire("react");
  const { renderToStaticMarkup } = nodeRequire("react-dom/server");
  for (const answer of [null, workflowAnswer, generalAnswer]) {
    const html = renderToStaticMarkup(React.createElement(compiledModule.exports.ResultCard, { mode: "troubleshooter", result: answer ? { mode: "troubleshooter", answer } : null }));
    for (const label of ["TROUBLESHOOTING GUIDANCE", "Likely issue area", "What may be happening", "Checks to perform", "Troubleshooting steps", "Expected behavior", "Relevant limitations", "Sources"]) assert(html.includes(label));
    for (const label of ["Recommended Configuration", "Recommended configuration", "Suggested Logic", "Target Entity"]) assert(!html.includes(label));
  }
  console.log("PASS: frontend Troubleshooter labels for empty, workflow, and general results");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
