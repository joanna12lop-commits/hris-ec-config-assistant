import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateEmbedding } from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CleanedChunk = {
  title: string;
  topic: string;
  source_section: string;
  page: number;
  source_summary: string;
  supported_use_cases: string[];
  trigger_event: string;
  base_object_entity: string;
  configuration_logic: string;
  important_limitations: string[];
  source_url: string;
};

type KnowledgeRow = {
  source_title: string;
  section: string;
  page_number: number;
  content: string;
  embedding: number[];
};

function validateCleanedChunk(
  value: unknown,
  index: number,
): { chunk?: CleanedChunk; error?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: `Chunk ${index} (title unavailable) has invalid field "chunk": expected an object.`,
    };
  }

  const chunk = value as Record<string, unknown>;
  const title =
    typeof chunk.title === "string" ? chunk.title : "title unavailable";
  const stringFields = [
    "title",
    "topic",
    "source_section",
    "source_summary",
    "trigger_event",
    "base_object_entity",
    "configuration_logic",
    "source_url",
  ];

  for (const field of stringFields) {
    if (typeof chunk[field] !== "string") {
      return {
        error: `Chunk ${index} ("${title}") has invalid field "${field}": expected a string.`,
      };
    }
  }

  if (typeof chunk.page !== "number" || !Number.isFinite(chunk.page)) {
    return {
      error: `Chunk ${index} ("${title}") has invalid field "page": expected a finite number.`,
    };
  }

  for (const field of ["supported_use_cases", "important_limitations"]) {
    if (
      !Array.isArray(chunk[field]) ||
      !chunk[field].every((item) => typeof item === "string")
    ) {
      return {
        error: `Chunk ${index} ("${title}") has invalid field "${field}": expected an array of strings.`,
      };
    }
  }

  return { chunk: chunk as unknown as CleanedChunk };
}

async function loadKnowledgeChunks(): Promise<CleanedChunk[]> {
  const dataPath = join(process.cwd(), "data", "ec_rag_chunks_cleaned.json");
  const rawData = await readFile(dataPath, "utf8");
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(rawData);
  } catch {
    throw new Error("The cleaned knowledge dataset is not valid JSON.");
  }

  if (!Array.isArray(parsedData)) {
    throw new Error(
      "The cleaned knowledge dataset must be a top-level JSON array.",
    );
  }

  const chunks: CleanedChunk[] = [];
  const validationErrors: string[] = [];
  parsedData.forEach((value, index) => {
    const result = validateCleanedChunk(value, index + 1);
    if (result.chunk) {
      chunks.push(result.chunk);
    } else if (result.error) {
      validationErrors.push(result.error);
    }
  });

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  const identities = new Set<string>();
  for (const [index, chunk] of chunks.entries()) {
    const identity = JSON.stringify([chunk.title, chunk.source_section]);
    if (identities.has(identity)) {
      throw new Error(
        `Chunk ${index + 1} ("${chunk.title}") has duplicate identity fields "title" and "source_section".`,
      );
    }
    identities.add(identity);
  }

  return chunks;
}

function createEmbeddingInput(chunk: CleanedChunk): string {
  return [
    `Title: ${chunk.title}`,
    `Topic: ${chunk.topic}`,
    `Source section: ${chunk.source_section}`,
    `Source summary: ${chunk.source_summary}`,
    `Supported use cases: ${chunk.supported_use_cases.join("; ")}`,
    `Trigger event: ${chunk.trigger_event}`,
    `Base object/entity: ${chunk.base_object_entity}`,
    `Configuration logic: ${chunk.configuration_logic}`,
    `Important limitations: ${chunk.important_limitations.join("; ")}`,
  ].join("\n\n");
}

function createSearchableContent(chunk: CleanedChunk): string {
  return [
    `Title: ${chunk.title}`,
    `Topic: ${chunk.topic}`,
    `Source section: ${chunk.source_section}`,
    `Source summary: ${chunk.source_summary}`,
    `Supported use cases: ${chunk.supported_use_cases.join("; ")}`,
    `Trigger event: ${chunk.trigger_event}`,
    `Base object/entity: ${chunk.base_object_entity}`,
    `Configuration logic: ${chunk.configuration_logic}`,
    `Important limitations: ${chunk.important_limitations.join("; ")}`,
    `Source URL: ${chunk.source_url}`,
  ].join("\n\n");
}

function identity(sourceTitle: string, section: string): string {
  return JSON.stringify([sourceTitle, section]);
}

export async function seedKnowledgeChunks({
  refresh = false,
}: { refresh?: boolean } = {}) {
  const knowledgeChunks = await loadKnowledgeChunks();
  const { data: existingChunks, error: lookupError } = await supabaseAdmin
    .from("knowledge_chunks")
    .select("source_title,section");

  if (lookupError) {
    throw new Error(
      `Could not check existing knowledge chunks: ${lookupError.message}`,
    );
  }

  const existingIdentities = new Set(
    (existingChunks ?? []).map(({ source_title, section }) =>
      identity(source_title, section),
    ),
  );
  const rowsToInsert: KnowledgeRow[] = [];
  const rowsToUpdate: KnowledgeRow[] = [];
  let skippedCount = 0;

  for (const chunk of knowledgeChunks) {
    const rowExists = existingIdentities.has(
      identity(chunk.title, chunk.source_section),
    );

    if (rowExists && !refresh) {
      skippedCount += 1;
      continue;
    }

    const row: KnowledgeRow = {
      source_title: chunk.title,
      section: chunk.source_section,
      page_number: chunk.page,
      content: createSearchableContent(chunk),
      embedding: await generateEmbedding(createEmbeddingInput(chunk)),
    };

    if (rowExists) {
      rowsToUpdate.push(row);
    } else {
      rowsToInsert.push(row);
    }
  }

  let updatedCount = 0;
  for (const row of rowsToUpdate) {
    const { data, error } = await supabaseAdmin
      .from("knowledge_chunks")
      .update(row)
      .eq("source_title", row.source_title)
      .eq("section", row.section)
      .select("id");

    if (error) {
      throw new Error(
        `Could not refresh knowledge chunk "${row.source_title}" / "${row.section}": ${error.message}`,
      );
    }

    updatedCount += data?.length ?? 0;
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("knowledge_chunks")
      .insert(rowsToInsert);

    if (insertError) {
      throw new Error(
        `Could not insert cleaned knowledge chunks: ${insertError.message}`,
      );
    }
  }

  return {
    insertedCount: rowsToInsert.length,
    updatedCount,
    skippedCount,
  };
}
