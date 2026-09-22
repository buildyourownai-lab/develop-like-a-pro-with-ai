import { mobileErrorResponse, mobileMarketResponse } from "@/lib/mobile-api";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await mobileMarketResponse());
  } catch (caught) {
    return mobileErrorResponse(caught);
  }
}
