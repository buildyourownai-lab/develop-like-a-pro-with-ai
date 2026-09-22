export type EnvKey =
  | "DATA_GO_KR_SERVICE_KEY"
  | "OPEN_DART_API_KEY"
  | "GEMINI_API_KEY"
  | "SUPABASE_DATABASE_URL"
  | "UPSTASH_REDIS_REST_URL"
  | "UPSTASH_REDIS_REST_TOKEN";

export interface SecretFieldDef {
  key: EnvKey;
  label: string;
  description: string;
  group: string;
}

const PREVIOUS_CHAPTERS = "이전 장에서 넣은 인증키";
const CHAPTER_12 = "12장에서 새로 쓰는 값";

export const SECRET_FIELDS: SecretFieldDef[] = [
  {
    key: "DATA_GO_KR_SERVICE_KEY",
    label: "공공데이터포털 인증키",
    description:
      "금융위원회 주식시세정보·지수시세정보, KRX상장종목정보가 함께 쓰는 값",
    group: PREVIOUS_CHAPTERS,
  },
  {
    key: "OPEN_DART_API_KEY",
    label: "OpenDART 인증키",
    description: "전자공시(DART) 조회에 쓰는 값",
    group: PREVIOUS_CHAPTERS,
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API Key",
    description: "AI 브리핑 생성에 쓰는 값",
    group: PREVIOUS_CHAPTERS,
  },
  {
    key: "SUPABASE_DATABASE_URL",
    label: "Supabase Database URL",
    description: "Supabase Postgres 연결 문자열",
    group: CHAPTER_12,
  },
  {
    key: "UPSTASH_REDIS_REST_URL",
    label: "Upstash Redis REST URL",
    description: "Upstash Redis REST API 주소",
    group: CHAPTER_12,
  },
  {
    key: "UPSTASH_REDIS_REST_TOKEN",
    label: "Upstash Redis REST Token",
    description: "Upstash Redis REST API 인증 토큰",
    group: CHAPTER_12,
  },
];

export const ENV_KEYS: EnvKey[] = SECRET_FIELDS.map((field) => field.key);
