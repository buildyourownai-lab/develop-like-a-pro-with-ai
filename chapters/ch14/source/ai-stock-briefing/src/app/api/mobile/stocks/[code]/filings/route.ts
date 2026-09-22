import type { NextRequest } from "next/server";
import { mobileErrorResponse, mobileFilingsResponse } from "@/lib/mobile-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    return Response.json(await mobileFilingsResponse((await params).code, request.nextUrl.searchParams.get("page")));
  } catch (caught) {
    return mobileErrorResponse(caught);
  }
}
