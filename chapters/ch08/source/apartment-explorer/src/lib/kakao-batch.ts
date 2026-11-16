type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type Binding = { fetch(request: Request): Promise<Response> };
type Pending = {
  url: string;
  init: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};

// One queue per search, never shared across requests or credentials. Each private
// Worker invocation has its own external-request budget (Workers Free: 50).
export function createKakaoBatchFetch(binding: Binding): FetchLike {
  let queue: Pending[] = [];
  let scheduled = false;
  async function flush() {
    const items = queue;
    queue = [];
    scheduled = false;
    for (let offset = 0; offset < items.length; offset += 40) {
      const batch = items.slice(offset, offset + 40).filter(item => !item.init.signal?.aborted);
      if (!batch.length) continue;
      try {
        const authorization = new Headers(batch[0].init.headers).get("Authorization");
        if (!authorization || batch.some(item => new Headers(item.init.headers).get("Authorization") !== authorization)) {
          throw new Error("Invalid Kakao batch credentials");
        }
        const response = await binding.fetch(new Request("https://kakao.internal/batch", {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify(batch.map(item => item.url)),
          signal: AbortSignal.timeout(25000),
        }));
        if (!response.ok) throw new Error(`Kakao batch unavailable (${response.status})`);
        const results = await response.json() as { status?: number; body?: string; error?: boolean }[];
        if (!Array.isArray(results) || results.length !== batch.length) throw new Error("Invalid Kakao batch response");
        results.forEach((result, index) => {
          if (batch[index].init.signal?.aborted) batch[index].reject(new Error("Kakao request timed out"));
          else if (result.error) batch[index].reject(new Error("Kakao Local API connection failed"));
          else batch[index].resolve(new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } }));
        });
      } catch (error) {
        console.error('[kakao-batch]', error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[URL]') : 'binding failed');
        batch.forEach(item => item.reject(new Error("Kakao Local API connection failed")));
      }
    }
  }
  return (url, init) => new Promise((resolve, reject) => {
    if (init.signal?.aborted) return reject(new Error("Kakao request timed out"));
    let settled = false;
    const cleanup = () => init.signal?.removeEventListener("abort", onAbort);
    const resolveOnce = (response: Response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => rejectOnce(new Error("Kakao request timed out"));
    // Reject this caller immediately without cancelling other callers' shared batch.
    init.signal?.addEventListener("abort", onAbort, { once: true });
    queue.push({ url, init, resolve: resolveOnce, reject: rejectOnce });
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => { void flush(); }, 0);
    }
  });
}
