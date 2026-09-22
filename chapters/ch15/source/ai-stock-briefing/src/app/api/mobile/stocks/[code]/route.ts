import { mobileErrorResponse, mobileStockResponse } from "@/lib/mobile-api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    return Response.json(await mobileStockResponse((await params).code));
  } catch (caught) {
    return mobileErrorResponse(caught);
  }
}
