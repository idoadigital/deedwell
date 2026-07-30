import type { ModelRequest } from "./index.js";
import type { IntentOutput } from "@deedwell/schemas";

/**
 * MOCK intent router (see mock-provider.ts banner). Rule-based understanding
 * of the core workspace phrases; anything else gets an honest "clarify".
 * The OpenAI provider replaces this with real language understanding.
 */

export interface AssistantContext {
  orgName: string;
  channelKind: "team" | "project";
  projectType: string | null;
  lastSearchResults: Array<{ index: number; title: string }>;
  lastUploadedFileId: string | null;
  pendingApprovals: Array<{ id: string; kind: string }>;
  waitingRuns: Array<{ id: string; status: string; missingFacts: string[] }>;
  hasSite: boolean;
  knownUrls?: Record<string, string>;
  knownArtifacts?: Array<{ id: string; type: string; title: string }>;
}

export function mockIntent(request: ModelRequest): IntentOutput {
  const text = request.dataBlocks.find((b) => b.label === "user_message")?.content?.trim() ?? "";
  let ctx: AssistantContext;
  try {
    ctx = JSON.parse(request.dataBlocks.find((b) => b.label === "context")?.content ?? "{}");
  } catch {
    ctx = {
      orgName: "", channelKind: "team", projectType: null, lastSearchResults: [],
      lastUploadedFileId: null, pendingApprovals: [], waitingRuns: [], hasSite: false,
    };
  }
  const lower = text.toLowerCase();

  // Missing-info replies: "annual_budget: $420,000" style lines.
  const missingKeys = new Set(ctx.waitingRuns?.flatMap((r) => r.missingFacts ?? []) ?? []);
  const factLines = [...text.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_ ]{1,40})\s*[:=]\s*(.+?)\s*$/gm)]
    .map((m) => ({ key: m[1]!.trim().toLowerCase().replace(/\s+/g, "_"), value: m[2]!.trim() }))
    .filter((f) => f.value.length > 0);
  if (factLines.length && (missingKeys.size === 0 || factLines.some((f) => missingKeys.has(f.key)))) {
    if (missingKeys.size > 0) return { action: "provide_info", facts: factLines };
  }

  if (/\b(find|search|look(ing)? for|discover)\b/.test(lower) && /\b(grant|fund|opportunit)/.test(lower)) {
    const afterFor = text.match(/\bfor\s+(?:our\s+|the\s+|a\s+)?(.{3,80}?)(?:\.|$)/i)?.[1];
    const keyword = (afterFor ?? lower
      .replace(/\b(please|can you|could you|find|search|look(ing)? for|discover|grants?|funding|opportunit(y|ies))\b/g, " ")
      .replace(/\s+/g, " ")
      .trim())
      .replace(/\bprograms?\b\s*$/, "")
      .trim();
    return { action: "search_grants", keyword: keyword.length >= 2 ? keyword : "nonprofit" };
  }

  const applyMatch = lower.match(/\b(apply|start|go)\b[^#\d]*#?\s*(\d{1,2})/);
  if (applyMatch && ctx.lastSearchResults?.length) {
    return { action: "start_grant_application", resultIndex: Number(applyMatch[2]) };
  }

  // Memory recall: the agent must never ask for links it generated itself.
  if (/\b(link|url|preview|website|site)\b/.test(lower) &&
      /\b(you (built|created|made|gave)|the website|what.*(build|built)|open|show me|where)\b/.test(lower) &&
      ctx.knownUrls && Object.keys(ctx.knownUrls).length > 0) {
    const entries = Object.entries(ctx.knownUrls);
    const live = entries.find(([k]) => k.endsWith("_live"));
    const preview = entries.find(([k]) => k.endsWith("_preview"));
    const parts = [];
    if (live) parts.push(`live site: ${live[1]}`);
    if (preview) parts.push(`preview: ${preview[1]}`);
    return {
      action: "answer",
      text: `I found it in the project's artifact registry — ${parts.join(" · ")}. I can update it, republish, or roll it back; just say the word.`,
    };
  }

  if (/\b(build|create|make|set ?up)\b/.test(lower) && /\b(web ?site|web ?page|site)\b/.test(lower)) {
    if (ctx.hasSite && ctx.knownUrls && Object.keys(ctx.knownUrls).length > 0) {
      const first = Object.values(ctx.knownUrls)[0];
      return {
        action: "answer",
        text: `This project already has a website (${first}). Tell me what to change and Noah will patch it — or say "build a new website" in a fresh project if you want to start over.`,
      };
    }
    return { action: "build_website", siteName: null };
  }

  if (/\b(approve[d]?|publish it|go ahead|ship it|looks good|lgtm|yes do it)\b/.test(lower) && ctx.pendingApprovals?.length) {
    return { action: "approve", note: null };
  }
  if (/\b(reject|decline|don'?t (publish|apply|pursue)|do not (publish|apply|pursue)|send it back)\b/.test(lower) && ctx.pendingApprovals?.length) {
    return { action: "reject", note: null };
  }

  if (ctx.hasSite && /\b(change|update|add|remove|replace|rename|rewrite|make the)\b/.test(lower)) {
    return { action: "update_website", instruction: text };
  }

  if (/\b(status|progress|update me|what('| i)s (happening|going on)|show me .*(project|run|work))\b/.test(lower)) {
    return { action: "status" };
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) {
    return {
      action: "answer",
      text: `Hello! I'm Maya, your Executive Assistant. I can search for grants ("find grants for youth programs"), start applications, build and update your website, and route approvals. What would you like to work on?`,
    };
  }
  if (/\bwhat can you do|help\b/.test(lower)) {
    return {
      action: "answer",
      text: `I coordinate your AI team. Try: "find grants for <your program>", "apply for #1", "build our website", "change the tagline to \\"…\\"", "status", or answer my questions when the team needs information. Sensitive steps always come back to you for approval.`,
    };
  }

  return {
    action: "clarify",
    question:
      "I couldn't map that to an action I can take. [mock router — with a real model provider I'd understand free-form requests] Try: \"find grants for …\", \"apply for #N\", \"build our website\", \"change the tagline to '…'\", or \"status\".",
  };
}
