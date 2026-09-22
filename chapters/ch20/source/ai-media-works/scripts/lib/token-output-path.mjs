import { resolve, sep } from "node:path";

export const DEFAULT_TOKEN_RELATIVE_PATH = ".secrets/youtube-comment-read-oauth.json";

/**
 * Confines where the comment-read token file can be written: inside this
 * project only, and never at the same path as the OAuth client JSON. The
 * beginner CLI flow never lets a caller choose a path at all — it always
 * uses DEFAULT_TOKEN_RELATIVE_PATH — but this check exists as a second,
 * independent guard so a bad path can never overwrite chapter 18's token
 * file or an arbitrary file outside the project, even if this function is
 * ever called with something other than the default.
 */
export function resolveTokenOutputPath({ projectRoot, clientJsonPath, tokenOutputPath }) {
  const resolvedRoot = resolve(projectRoot);
  const resolvedToken = resolve(resolvedRoot, tokenOutputPath);
  const resolvedClient = resolve(clientJsonPath);

  const withinRoot = resolvedToken === resolvedRoot || resolvedToken.startsWith(resolvedRoot + sep);
  if (!withinRoot) {
    return {
      ok: false,
      reason: "token_path_outside_project",
      message: "Token 저장 경로는 이 프로젝트 폴더 안에만 지정할 수 있습니다.",
    };
  }

  if (resolvedToken === resolvedClient) {
    return {
      ok: false,
      reason: "token_path_same_as_client_json",
      message: "Token 저장 경로가 OAuth client JSON 파일 경로와 같을 수 없습니다.",
    };
  }

  return { ok: true, path: resolvedToken };
}
