import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { path?: string; at?: string };
    console.error("TBFT_CLIENT_CLOUD_TIMEOUT", {
      path: String(body.path ?? "unknown").slice(0, 1200),
      at: String(body.at ?? "unknown").slice(0, 80),
      userAgent: request.headers.get("user-agent")?.slice(0, 240) ?? "unknown",
    });
  } catch {
    console.error("TBFT_CLIENT_CLOUD_TIMEOUT", { path: "unparseable" });
  }
  return NextResponse.json({ ok: true });
}
