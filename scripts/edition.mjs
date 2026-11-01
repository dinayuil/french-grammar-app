/**
 * The single edition parser shared by the Vite config, content loader and
 * command-line wrappers. Missing means public; every other unknown value is a
 * hard failure (no silent fallback to the other content repository).
 *
 * @param {string | undefined} raw
 * @returns {"public" | "internal"}
 */
export function resolveEdition(raw) {
  if (raw === undefined) return "public";
  if (raw === "public" || raw === "internal") return raw;
  throw new Error(
    `FGE_EDITION 非法: ${JSON.stringify(raw)}；只能是 public 或 internal`
  );
}
