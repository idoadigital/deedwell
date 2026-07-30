import { createHash } from "node:crypto";
import type { StorageAdapter } from "@deedwell/database";

/**
 * Agent voices: Kokoro-82M (Apache-2.0 open-source TTS) running in-process
 * via ONNX — no Python, no external voice API, nothing leaves the server.
 * Lazily loaded on first use; synthesized clips are content-addressed and
 * cached in storage. VOICE_PROVIDER=off disables voices honestly (the huddle
 * falls back to captions-only and says so).
 */

let ttsPromise: Promise<{ generate: (text: string, opts: { voice: string }) => Promise<{ toWav: () => ArrayBuffer }> }> | null = null;
let loadError: string | null = null;

async function getTts() {
  if (loadError) throw new Error(loadError);
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const started = Date.now();
      const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
      });
      console.log(JSON.stringify({ at: "tts_model_loaded", ms: Date.now() - started, model: "Kokoro-82M q8" }));
      return tts as never;
    })().catch((err) => {
      loadError = `Voice model failed to load: ${err instanceof Error ? err.message : err}`;
      ttsPromise = null;
      throw new Error(loadError);
    });
  }
  return ttsPromise;
}

export function voiceEnabled(): boolean {
  return (process.env.VOICE_PROVIDER ?? "kokoro") === "kokoro";
}

export async function synthesize(
  storage: StorageAdapter,
  voice: string,
  text: string
): Promise<Buffer> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 600);
  const key = `tts/${voice}/${createHash("sha256").update(clean).digest("hex").slice(0, 24)}.wav`;
  try {
    return await storage.get(key); // content-addressed cache hit
  } catch {
    /* miss — synthesize */
  }
  const tts = await getTts();
  const started = Date.now();
  const audio = await tts.generate(clean, { voice });
  const wav = Buffer.from(audio.toWav());
  console.log(JSON.stringify({ at: "tts_generate", voice, chars: clean.length, bytes: wav.length, ms: Date.now() - started }));
  await storage.put(key, wav);
  return wav;
}
