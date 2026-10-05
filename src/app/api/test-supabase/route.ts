import "server-only";

import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY: This endpoint only verifies the Supabase connection.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("knowledge_chunks")
      .select("id")
      .limit(1);

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      message: "Supabase connection successful",
      rowCount: data?.length ?? 0,
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
