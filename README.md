# HRIS EC Configuration Assistant

An independent educational portfolio project for exploring SAP SuccessFactors Employee Central (EC) configuration concepts.

**Live demo:** [hris-ec-config-assistant.vercel.app](https://hris-ec-config-assistant.vercel.app)

## Project Overview

The application translates natural-language HRIS business requirements and configuration issues into structured SAP SuccessFactors Employee Central guidance. Answers are generated from a curated knowledge base and include supporting sources where relevant. When retrieved documentation does not provide enough detail, the assistant is intended to say so rather than present unsupported setup instructions.

For example, a user can ask:

> I changed an employee's FTE in Job Information and want the recurring pay component to update automatically.

The assistant can return a recommended configuration, relevant EC area, trigger, base object, target entity or target field, suggested logic, rationale, configuration guidance, important considerations, validation steps, and supporting sources.

## Features

- **Configuration Advisor** for business requirements
- **Troubleshooter** for configuration issues
- Retrieval-Augmented Generation (RAG) over curated Employee Central knowledge
- Semantic search using vector embeddings
- Source-grounded answers with structured configuration recommendations
- In-memory response caching for repeated normalized queries
- Lightweight server-side rate limiting
- Public demo allowance of three successful uncached live AI requests per browser session
- Deployment on Vercel

Cached requests reuse the complete answer and do not make another OpenAI embedding or answer-generation call.

## Knowledge Base

The curated knowledge base covers selected Employee Central topics, including:

- Business Rules
- Rule Events
- Event Reason Derivation
- Workflow Derivation
- Cross-Entity Rules
- Forward Propagation
- Rule Context
- Job Information configuration scenarios

Coverage is limited to the material currently included in the knowledge base and should not be treated as a complete reference for every Employee Central scenario.

## Architecture

```text
User query
  -> OpenAI embedding
  -> Supabase pgvector similarity search
  -> Relevant knowledge chunks
  -> Grounded LLM response
  -> Structured configuration guidance
```

OpenAI calls and Supabase administrative access run server-side. Retrieved chunks are supplied as model context, and the answer flow filters sources to those that directly support the response.

## Tech Stack

- Next.js
- TypeScript
- React
- Tailwind CSS
- Supabase
- PostgreSQL
- pgvector
- OpenAI API
- Vercel

## Local Development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For local server configuration, use `.env.example` as a variable-name template and keep `.env.local` private. Never commit API keys or service-role credentials.

## Cost Protection

- The browser session is limited to three successful uncached live AI requests.
- A lightweight server-side rate limiter provides a second request guard.
- Responses are cached in memory by normalized query and mode.
- A cache hit reuses the full answer without another OpenAI embedding or generation request.
- All uncached `/api/analyze` requests share a persistent allowance of 30 per UTC day in Supabase. In-flight requests reserve capacity before embedding or answer generation; successful requests keep their slot, and caught failures release it.

The cache and rate limiter are process-local safeguards for this small public demo, not a distributed quota system.

### Manual daily quota setup

Run all of [supabase/daily-ai-usage.sql](supabase/daily-ai-usage.sql) manually in the Supabase SQL Editor before deploying this version. The application and build do not run this SQL or modify the database schema. It creates the daily counter and atomic claim/release RPCs, with access limited to the server's service role.

The request order is input validation, existing cache, existing rate limiter, daily quota claim, embedding/retrieval, and answer generation. Cache hits never query or consume the daily quota. Supabase determines the claim's UTC date, and a failure releases against that original date, even after midnight. An empty retrieval still consumes one slot because its embedding call succeeded.

If quota storage is unavailable or the SQL has not been installed, uncached analyses stop before OpenAI calls. If a release cannot be persisted, or the server stops before cleanup runs, the reservation remains for that day; the server logs release errors and does not risk a duplicate decrement. The next UTC day has a separate counter, so no reset job is needed.

The quota covers live analyses through `/api/analyze`. The temporary `/api/test-search` and `/api/seed-knowledge` endpoints return 404 in production so they cannot bypass the allowance. They remain available in development for maintenance.

## Disclaimer

This project is for educational and portfolio use only. It is not affiliated with, endorsed by, or an official tool of SAP SE. Configuration recommendations should be validated against the customer's SAP SuccessFactors environment and current official documentation. SAP and SAP SuccessFactors are trademarks of SAP SE.
