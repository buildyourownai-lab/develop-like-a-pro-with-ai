"use server";

import { headers } from "next/headers";
import { getEnvLocalStatus, upsertEnvLocalValues } from "@/lib/env-file";
import { isLocalHostname } from "@/lib/local-request";
import { ENV_KEYS, type EnvKey } from "@/lib/secret-fields";

export type SaveSecretsState = {
  ok: boolean;
  message: string;
  status: Record<EnvKey, boolean>;
};

export async function saveSecretsAction(
  prevState: SaveSecretsState,
  formData: FormData
): Promise<SaveSecretsState> {
  const headerList = await headers();
  if (!isLocalHostname(headerList.get("host"))) {
    return {
      ok: false,
      message: "이 화면은 내 컴퓨터(localhost)에서 열었을 때만 저장할 수 있습니다.",
      status: prevState.status,
    };
  }

  const updates: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const raw = formData.get(key);
    if (typeof raw === "string" && raw.trim() !== "") {
      updates[key] = raw;
    }
  }

  const savedCount = Object.keys(updates).length;
  if (savedCount > 0) {
    await upsertEnvLocalValues(updates);
  }

  const status = await getEnvLocalStatus();

  return {
    ok: true,
    message:
      savedCount > 0
        ? `${savedCount}개 값을 .env.local에 저장했습니다. 빈칸으로 둔 항목은 기존 값을 그대로 남겼습니다.`
        : "입력한 값이 없어 저장하지 않았습니다. 기존 값은 그대로입니다.",
    status,
  };
}
