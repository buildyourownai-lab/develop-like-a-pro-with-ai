"use client";

import { useActionState } from "react";
import { saveSecretsAction, type SaveSecretsState } from "./actions";
import type { EnvKey, SecretFieldDef } from "@/lib/secret-fields";
import styles from "./setup.module.css";

// SECRET_FIELDS 자체(키 이름이 문자열로 든 배열)는 여기서 import하지 않는다.
// 이 컴포넌트는 브라우저로 내려가는 클라이언트 번들에 포함되므로, 그 배열을
// 직접 가져오면 인증키 이름이 정적 빌드 산출물에 그대로 박힌다. 대신 서버
// 컴포넌트(page.tsx)가 값을 읽어 props로 내려준다.
export function SecretForm({
  fields,
  initialStatus,
}: {
  fields: SecretFieldDef[];
  initialStatus: Record<EnvKey, boolean>;
}) {
  const [state, formAction, pending] = useActionState<SaveSecretsState, FormData>(
    saveSecretsAction,
    { ok: true, message: "", status: initialStatus }
  );

  const groups = [...new Set(fields.map((field) => field.group))];

  return (
    <form action={formAction} className={styles.form}>
      {groups.map((group) => (
        <fieldset key={group} className={styles.group}>
          <legend>{group}</legend>
          {fields
            .filter((field) => field.group === group)
            .map((field) => (
              <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>
                  {field.label}
                  {state.status[field.key] && (
                    <span className={styles.badge}>설정됨</span>
                  )}
                </span>
                <input
                  type="password"
                  name={field.key}
                  placeholder="비워두면 기존 값을 그대로 둡니다"
                  autoComplete="off"
                  className={styles.input}
                />
                <span className={styles.fieldDescription}>
                  {field.description}
                </span>
              </label>
            ))}
        </fieldset>
      ))}

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? "저장하는 중..." : "저장"}
      </button>

      {state.message && (
        <p
          aria-live="polite"
          className={state.ok ? styles.success : styles.error}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
