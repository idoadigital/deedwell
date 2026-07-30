/**
 * Document normalization: PDF, DOCX, HTML, TXT, MD → plain text for the
 * pipeline. Users are never forced to convert files themselves.
 */
export async function extractDocumentText(
  buffer: Buffer,
  filename: string
): Promise<{ text: string; kind: string }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const mod = await import("pdf-parse");
    const pdf = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
    const out = await pdf(buffer);
    return { text: normalize(out.text), kind: "pdf" };
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const out = await mammoth.extractRawText({ buffer });
    return { text: normalize(out.value), kind: "docx" };
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return { text: stripHtml(buffer.toString("utf8")), kind: "html" };
  }
  return { text: normalize(buffer.toString("utf8")), kind: "text" };
}

export function stripHtml(html: string): string {
  return normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  );
}

function normalize(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
