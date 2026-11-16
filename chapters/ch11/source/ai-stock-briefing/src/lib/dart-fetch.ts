import "server-only";
// Never include request URLs (which contain credentials) or provider bodies in errors.
export async function fetchDart(url: string | URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json, application/zip", "User-Agent": "BookStockBriefing/1.0" },
      redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error("OpenDART 요청에 실패했습니다."); }
  if (!response.ok) throw new Error(`OpenDART HTTP ${response.status}`);
  return response;
}
