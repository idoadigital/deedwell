/**
 * Grant opportunity discovery (BRD §8.1 Opportunity Researcher).
 * `GrantsGovProvider` calls the real public Grants.gov Search2 API.
 * `MockGrantSource` is a clearly identified mock for tests and offline dev.
 */

export interface OpportunityRecord {
  externalId: string;
  opportunityNumber: string;
  title: string;
  agency: string;
  openDate: string | null;
  closeDate: string | null; // YYYY-MM-DD
  status: string;
  sourceUrl: string;
  source: "grants_gov" | "mock";
  retrievedAt: string;
}

export interface GrantSourceProvider {
  readonly name: string;
  search(keyword: string, limit?: number): Promise<OpportunityRecord[]>;
  /** Retrieve the full announcement text automatically, or null if unavailable. */
  fetchAnnouncement(externalId: string): Promise<{ text: string; title: string } | null>;
}

interface GrantsGovHit {
  id: string;
  number: string;
  title: string;
  agency?: string;
  agencyCode?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
}

/** Real integration with api.grants.gov (public, no key required). */
export class GrantsGovProvider implements GrantSourceProvider {
  readonly name = "grants_gov";
  constructor(private readonly baseUrl = "https://api.grants.gov/v1/api") {}

  async search(keyword: string, limit = 10): Promise<OpportunityRecord[]> {
    const res = await fetch(`${this.baseUrl}/search2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword, rows: limit, oppStatuses: "posted" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Grants.gov search failed with status ${res.status}`);
    const payload = (await res.json()) as {
      errorcode: number;
      msg: string;
      data?: { oppHits?: GrantsGovHit[] };
    };
    if (payload.errorcode !== 0) throw new Error(`Grants.gov error: ${payload.msg}`);
    const retrievedAt = new Date().toISOString();
    return (payload.data?.oppHits ?? []).map((hit) => ({
      externalId: hit.id,
      opportunityNumber: hit.number,
      title: hit.title,
      agency: hit.agency ?? hit.agencyCode ?? "Unknown agency",
      openDate: normalizeDate(hit.openDate),
      closeDate: normalizeDate(hit.closeDate),
      status: hit.oppStatus ?? "posted",
      sourceUrl: `https://www.grants.gov/search-results-detail/${hit.id}`,
      source: "grants_gov",
      retrievedAt,
    }));
  }

  async fetchAnnouncement(externalId: string): Promise<{ text: string; title: string } | null> {
    try {
      const data = await fetchOpportunityDetails(this.baseUrl, externalId);
      if (!data) return null;
      const syn = (data.synopsis ?? {}) as Record<string, unknown>;
      const strip = (h: string) =>
        h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      const parts = [
        `${fieldText(data.opportunityTitle)}`,
        `Opportunity Number: ${fieldText(data.opportunityNumber)}`,
        syn.synopsisDesc ? `\nDescription:\n${strip(fieldText(syn.synopsisDesc))}` : "",
        syn.applicantEligibilityDesc ? `\nApplicant eligibility: ${strip(fieldText(syn.applicantEligibilityDesc))}` : "",
        syn.fundingActivityCategoryDesc ? `Funding category: ${strip(fieldText(syn.fundingActivityCategoryDesc))}` : "",
        syn.awardCeiling ? `Award ceiling: $${syn.awardCeiling}` : "",
        syn.responseDate ? `Applications must be submitted by the deadline of ${fieldText(syn.responseDate)}.` : "",
        syn.agencyContactDesc ? `Agency contact: ${strip(fieldText(syn.agencyContactDesc))}` : "",
      ].filter(Boolean);
      const text = parts.join("\n");
      if (text.length < 200) return null; // too thin to analyze honestly
      return { text, title: fieldText(data.opportunityTitle) || "Announcement" };
    } catch {
      return null;
    }
  }
}

/** Fetch full opportunity details (synopsis, eligibility, instructions). */
async function fetchOpportunityDetails(baseUrl: string, externalId: string) {
  const res = await fetch(`${baseUrl}/fetchOpportunity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opportunityId: Number(externalId) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { errorcode: number; data?: Record<string, unknown> };
  if (payload.errorcode !== 0 || !payload.data) return null;
  return payload.data;
}

function fieldText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Grants.gov returns MM/DD/YYYY; normalize to YYYY-MM-DD. */
function normalizeDate(value?: string): string | null {
  if (!value) return null;
  const us = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** ===== MOCK — deterministic stand-in for tests and offline development. ===== */
// (GrantsGovProvider.fetchAnnouncement lives on the class below via prototype merge)

export class MockGrantSource implements GrantSourceProvider {
  readonly name = "mock";

  async search(keyword: string, limit = 10): Promise<OpportunityRecord[]> {
    const retrievedAt = new Date().toISOString();
    const deadline = new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return [
      {
        externalId: "MOCK-001",
        opportunityNumber: "MOCK-2026-001",
        title: `${keyword} Capacity Building Program [mock source]`,
        agency: "Mock Federal Agency",
        openDate: null,
        closeDate: deadline,
        status: "posted",
        sourceUrl: "https://example.invalid/mock-001",
        source: "mock" as const,
        retrievedAt,
      },
      {
        externalId: "MOCK-002",
        opportunityNumber: "MOCK-2026-002",
        title: `Community ${keyword} Innovation Fund [mock source]`,
        agency: "Mock Foundation",
        openDate: null,
        closeDate: deadline,
        status: "posted",
        sourceUrl: "https://example.invalid/mock-002",
        source: "mock" as const,
        retrievedAt,
      },
    ].slice(0, limit);
  }

  async fetchAnnouncement(externalId: string): Promise<{ text: string; title: string } | null> {
    if (externalId === "MOCK-001") {
      return {
        title: "Mock Capacity Building Program",
        text: [
          "Mock Capacity Building Program [mock source announcement]",
          "Applicants must be a registered 501(c)(3) nonprofit organization to be eligible.",
          "The narrative must not exceed 400 words and must describe the target population.",
          "The project budget must include a line-item budget justification.",
          "Applications must be submitted by the posted deadline.",
        ].join("\n"),
      };
    }
    return null; // MOCK-002: retrieval fails -> pending-intent path
  }
}

export function createGrantSource(kind = process.env.GRANT_SOURCE ?? "grants_gov"): GrantSourceProvider {
  if (kind === "mock") return new MockGrantSource();
  if (kind === "grants_gov") return new GrantsGovProvider();
  throw new Error(`Unknown grant source "${kind}". Available: grants_gov, mock.`);
}
