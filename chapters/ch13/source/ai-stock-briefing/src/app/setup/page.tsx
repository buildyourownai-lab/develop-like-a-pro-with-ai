import { getEnvLocalStatus } from "@/lib/env-file";
import { SECRET_FIELDS } from "@/lib/secret-fields";
import { SecretForm } from "./SecretForm";
import styles from "./setup.module.css";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const status = await getEnvLocalStatus();

  return (
    <main className={styles.main}>
      <h1>12장 Secret 입력</h1>
      <p>
        이 화면은 로컬 개발 서버에서만 씁니다. 입력한 값은 이 컴퓨터의{" "}
        <code>.env.local</code>에만 저장되고 Git에는 올라가지 않습니다.
      </p>
      <SecretForm fields={SECRET_FIELDS} initialStatus={status} />
    </main>
  );
}
