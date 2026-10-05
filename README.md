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

The cache and rate limiter are process-local safeguards for this small public demo, not a distributed quota system.

## Disclaimer

This project is for educational and portfolio use only. It is not affiliated with, endorsed by, or an official tool of SAP SE. Configuration recommendations should be validated against the customer's SAP SuccessFactors environment and current official documentation. SAP and SAP SuccessFactors are trademarks of SAP SE.
