import type {
  AgentInfo,
  Approval,
  ArtifactDetail,
  Organization,
  OrgFactRow,
  Project,
  RunDetail,
  RunSummary,
} from "./types";

export const API_URL: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? "http://localhost:3000";

const TOKEN_KEY = "deedwell.session";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  raw = false
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      /* keep default */
    }
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, message);
  }
  return (raw ? res.text() : res.json()) as Promise<T>;
}

// ---- auth -----------------------------------------------------------------

export const register = (email: string, password: string, displayName: string) =>
  call<{ userId: string; token: string }>("POST", "/v1/auth/register", {
    email,
    password,
    displayName,
  });

export const login = (email: string, password: string) =>
  call<{ userId: string; token: string }>("POST", "/v1/auth/login", { email, password });

export const logout = () => call<{ ok: true }>("POST", "/v1/auth/logout");

export const me = () =>
  call<{ userId: string; organizations: Organization[] }>("GET", "/v1/me");

// ---- orgs, projects, facts ------------------------------------------------

export const createOrg = (name: string, slug: string) =>
  call<{ orgId: string }>("POST", "/v1/orgs", { name, slug });

export const listProjects = (orgId: string) =>
  call<{ projects: Project[] }>("GET", `/v1/orgs/${orgId}/projects`);

export const createProject = (orgId: string, name: string, type: Project["type"]) =>
  call<{ projectId: string }>("POST", `/v1/orgs/${orgId}/projects`, { name, type });

export const listFacts = (orgId: string) =>
  call<{ facts: OrgFactRow[] }>("GET", `/v1/orgs/${orgId}/facts`);

export const saveFacts = (orgId: string, facts: Array<{ key: string; value: string }>) =>
  call<{ ok: true }>("POST", `/v1/orgs/${orgId}/facts`, { facts });

// ---- files & grant slice --------------------------------------------------

export const uploadFile = (
  orgId: string,
  projectId: string,
  filename: string,
  mime: "text/plain" | "text/markdown",
  contentBase64: string
) =>
  call<{ fileId: string }>("POST", `/v1/orgs/${orgId}/projects/${projectId}/files`, {
    filename,
    mime,
    contentBase64,
  });

export const startGrantSlice = (
  orgId: string,
  projectId: string,
  input: { fileId: string; opportunityTitle: string; funder: string; sectionTitle: string }
) =>
  call<{ runId: string; opportunityId: string }>(
    "POST",
    `/v1/orgs/${orgId}/projects/${projectId}/grant-slice`,
    input
  );

// ---- runs, approvals, artifacts -------------------------------------------

export const listRuns = (orgId: string) =>
  call<{ runs: RunSummary[] }>("GET", `/v1/orgs/${orgId}/runs`);

export const getRun = (orgId: string, runId: string) =>
  call<RunDetail>("GET", `/v1/orgs/${orgId}/runs/${runId}`);

export const provideInfo = (
  orgId: string,
  runId: string,
  facts: Array<{ key: string; value: string }>
) => call<{ ok: true }>("POST", `/v1/orgs/${orgId}/runs/${runId}/provide-info`, { facts });

export const listApprovals = (orgId: string) =>
  call<{ approvals: Approval[] }>("GET", `/v1/orgs/${orgId}/approvals`);

export const decideApproval = (
  orgId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string
) => call<{ ok: true }>("POST", `/v1/orgs/${orgId}/approvals/${approvalId}`, { decision, note });

export const getArtifact = (orgId: string, artifactId: string) =>
  call<ArtifactDetail>("GET", `/v1/orgs/${orgId}/artifacts/${artifactId}`);

export const getExportMarkdown = (orgId: string, artifactId: string) =>
  call<string>("GET", `/v1/orgs/${orgId}/artifacts/${artifactId}/export`, undefined, true);

// ---- agents ---------------------------------------------------------------

export const listAgents = () => call<{ agents: AgentInfo[] }>("GET", "/v1/agents");
