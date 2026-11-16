import { AsyncLocalStorage } from "node:async_hooks";
import { createKakaoBatchFetch } from "./kakao-batch";

type Transport = (url: string, init: RequestInit) => Promise<Response>;
const transport = new AsyncLocalStorage<Transport>();

// Each search owns its transport and queue; Node keeps the original direct fetch.
export function fetchKakao(url: string, init: RequestInit): Promise<Response> {
  return (transport.getStore() ?? fetch)(url, init);
}

export async function withKakaoTransport<T>(run: () => Promise<T>): Promise<T> {
  if (process.env.CLOUDFLARE_KAKAO_BATCH !== "1") return run();
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as { KAKAO_BATCH?: Parameters<typeof createKakaoBatchFetch>[0] }).KAKAO_BATCH;
  if (!binding) throw new Error("KAKAO_BATCH service binding is missing");
  return transport.run(createKakaoBatchFetch(binding), run);
}
