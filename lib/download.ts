const UNSAFE_FILENAME_CHARACTERS = /[\\/:*?"<>|]/gu;
const INVISIBLE_OR_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Produce a bounded, display-honest download name from untrusted upload names.
 * This is browser hygiene, not a filesystem authorization boundary.
 */
export function safeDownloadFilename(
  value: string,
  fallback = "confovhh-export.json",
  maximumCodePoints = 160,
): string {
  const boundedMaximum = Number.isSafeInteger(maximumCodePoints) && maximumCodePoints >= 32
    ? maximumCodePoints
    : 160;
  const cleanFallback = fallback
    .normalize("NFKC")
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, "")
    .replace(UNSAFE_FILENAME_CHARACTERS, "_")
    .trim() || "confovhh-export.json";
  let sanitized = String(value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, "")
    .replace(UNSAFE_FILENAME_CHARACTERS, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+|\.+$/gu, "");
  if (!sanitized || sanitized === "." || sanitized === "..") sanitized = cleanFallback;
  const codePoints = Array.from(sanitized);
  if (codePoints.length <= boundedMaximum) return sanitized;
  const extensionMatch = sanitized.match(/(\.[A-Za-z0-9_-]{1,16})$/u);
  const extension = extensionMatch?.[1] ?? "";
  const extensionLength = Array.from(extension).length;
  const stemBudget = Math.max(1, boundedMaximum - extensionLength);
  const stem = Array.from(extension ? sanitized.slice(0, -extension.length) : sanitized)
    .slice(0, stemBudget)
    .join("")
    .replace(/\.+$/gu, "");
  return `${stem || "confovhh-export"}${extension}`;
}
