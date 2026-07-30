/**
 * Open an external URL from web or the Tauri shell. In Tauri, anchor clicks
 * don't reach the system browser — the opener plugin does; on the web,
 * window.open with noopener. URLs are validated first; failures are surfaced
 * and logged, never swallowed.
 */
export function isValidExternalUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const inTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openExternal(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidExternalUrl(url)) {
    console.warn(JSON.stringify({ at: "open_external", ok: false, reason: "invalid_url", url }));
    return { ok: false, error: `Not a valid link: ${url || "(empty)"}` };
  }
  try {
    if (inTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) throw new Error("Popup blocked");
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to open";
    console.warn(JSON.stringify({ at: "open_external", ok: false, reason: error, url }));
    return { ok: false, error };
  }
}
