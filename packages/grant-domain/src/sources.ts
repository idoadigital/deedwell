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
}

/** Grants.gov returns MM/DD/YYYY; normalize to YYYY-MM-DD. */
function normalizeDate(value?: string): string | null {
  if (!value) return null;
  const us = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** ===== MOCK — deterministic stand-in for tests and offline development. ===== */
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
}

export function createGrantSource(kind = process.env.GRANT_SOURCE ?? "grants_gov"): GrantSourceProvider {
  if (kind === "mock") return new MockGrantSource();
  if (kind === "grants_gov") return new GrantsGovProvider();
  throw new Error(`Unknown grant source "${kind}". Available: grants_gov, mock.`);
}
