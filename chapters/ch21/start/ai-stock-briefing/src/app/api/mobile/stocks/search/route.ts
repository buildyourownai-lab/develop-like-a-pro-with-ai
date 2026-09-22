import type { NextRequest } from "next/server";

import { mobileErrorResponse, mobileSearchResponse } from "@/lib/mobile-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await mobileSearchResponse(request.nextUrl.searchParams.get("q") ?? ""));
  } catch (caught) {
    return mobileErrorResponse(caught);
  }
}
