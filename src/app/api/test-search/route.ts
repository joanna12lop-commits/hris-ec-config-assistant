import "server-only";

import { searchKnowledgeChunks } from "@/lib/knowledge-search";
import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY: Tests vector search against the seeded knowledge chunks.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const query =
      typeof body === "object" && body !== null && "query" in body
        ? body.query
        : undefined;

    if (typeof query !== "string" || query.trim().length === 0) {
      return Response.json(
        { success: false, error: "A non-empty query string is required." },
        { status: 400 },
      );
    }

    const { count: knowledgeRowCount, error: countError } = await supabaseAdmin
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true });

    if (countError) {
      return Response.json(
        { success: false, error: countError.message },
        { status: 500 },
      );
    }

    const matches = await searchKnowledgeChunks(query.trim());

    return Response.json({
      success: true,
      knowledgeRowCount: knowledgeRowCount ?? 0,
      matches,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
