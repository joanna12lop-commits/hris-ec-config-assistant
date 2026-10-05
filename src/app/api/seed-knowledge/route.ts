import "server-only";

import { seedKnowledgeChunks } from "@/lib/seed-knowledge";

// TEMPORARY: One-time ingestion endpoint for the cleaned Employee Central dataset.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "true";
    const result = await seedKnowledgeChunks({ refresh });
    return Response.json({ success: true, ...result });
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
