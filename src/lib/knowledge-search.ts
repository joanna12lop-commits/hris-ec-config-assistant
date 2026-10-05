import "server-only";

import { generateEmbedding } from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type KnowledgeMatch = {
  section: string;
  content: string;
  source_title: string;
  similarity: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnowledgeMatch(value: unknown): value is KnowledgeMatch {
  return (
    isRecord(value) &&
    typeof value.section === "string" &&
    typeof value.content === "string" &&
    typeof value.source_title === "string" &&
    typeof value.similarity === "number"
  );
}

export async function searchKnowledgeChunks(
  query: string,
): Promise<KnowledgeMatch[]> {
  const queryEmbedding = await generateEmbedding(query);
  const { data, error } = await supabaseAdmin.rpc("match_knowledge_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: 0.3,
    match_count: 5,
  });

  if (error) {
    throw new Error(`Knowledge search failed: ${error.message}`);
  }

  if (!Array.isArray(data) || !data.every(isKnowledgeMatch)) {
    throw new Error("Unexpected response from match_knowledge_chunks.");
  }

  return data.map(({ section, content, source_title, similarity }) => ({
    section,
    content,
    source_title,
    similarity,
  }));
}
