import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bridgeFlush } from "../../apps/api/src/assistant.js";
import { api, createOrg, createTestEnv, registerUser, type TestEnv } from "../helpers.js";

/**
 * Chat-first workspace: the entire grant journey driven through conversation —
 * DM Maya → search → agent-created channel → info requests → approvals — with
 * workflow milestones arriving as teammate messages.
 */

let env: TestEnv;
let token: string;
let orgId: string;

const drainAll = async () => {
  await env.deps.engine.drain("test-worker");
  await bridgeFlush();
};

const send = (channelId: string, body: string, fileId?: string) =>
  api(env.app, "POST", `/v1/orgs/${orgId}/channels/${channelId}/messages`, {
    token, body: { body, fileId: fileId ?? null },
  });

const messagesOf = async (channelId: string) =>
  (await api(env.app, "GET", `/v1/orgs/${orgId}/channels/${channelId}/messages`, { token })).body
    .messages as Array<{ author_kind: string; author_agent: string | null; body: string; metadata: any }>;

beforeAll(async () => {
  env = await createTestEnv();
  ({ token } = await registerUser(env.app, "chat@example.org"));
  orgId = await createOrg(env.app, token, "chat-org");
  await api(env.app, "POST", `/v1/orgs/${orgId}/facts`, {
    token,
    body: { facts: [
      { key: "legal_name", value: "Chat Org Inc." },
      { key: "mission", value: "Community programs" },
    ] },
  });
});
afterAll(async () => {
  await env.close();
});

describe("workspace conversations", () => {
  let channels: Array<{ id: string; key: string; kind: string; agent_key: string | null; name: string }>;
  let mayaDm: { id: string };

  it("provisions default channels, teammate DMs, and Maya's welcome", async () => {
    const res = await api(env.app, "GET", `/v1/orgs/${orgId}/channels`, { token });
    channels = res.body.channels;
    const keys = channels.map((c) => c.key);
    for (const expected of ["general", "announcements", "funding-opportunities", "grant-work", "website", "organization-information"]) {
      expect(keys).toContain(expected);
    }
    expect(channels.filter((c) => c.kind === "dm").length).toBe(13);
    expect(res.body.teammates.map((t: any) => t.name)).toContain("Maya");

    mayaDm = channels.find((c) => c.key === "dm:core.executive_assistant")!;
    const msgs = await messagesOf(mayaDm.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toContain("I'm Maya");
  });

  it("greets and answers in DM as the teammate persona", async () => {
    const res = await send(mayaDm.id, "hello");
    expect(res.status).toBe(201);
    const reply = res.body.messages.at(-1);
    expect(reply.author_kind).toBe("agent");
    expect(reply.author_agent).toBe("core.executive_assistant");
    expect(reply.body).toContain("Maya");
  });

  it("is honest when it cannot understand a request", async () => {
    const res = await send(mayaDm.id, "quantum synergize the paradigm backwards");
    expect(res.body.messages.at(-1).body).toContain("couldn't map that");
  });

  let searchChannelId: string;
  let grantChannelId: string;

  it("searches for grants in conversation (results from David, the researcher)", async () => {
    searchChannelId = channels.find((c) => c.key === "funding-opportunities")!.id;
    const res = await send(searchChannelId, "Find grants for our youth development program");
    const reply = res.body.messages.at(-1);
    expect(reply.author_agent).toBe("grant.opportunity_researcher");
    expect(reply.metadata.searchResults.length).toBeGreaterThan(0);
    expect(reply.metadata.searchResults[0].title).toContain("[mock source]");
  });

  it("requires the announcement document before applying — no guessing", async () => {
    const res = await send(searchChannelId, "apply for #1");
    expect(res.body.messages.at(-1).body).toContain("attach");
  });

  it("creates a project channel and starts the workflow when the document is attached", async () => {
    const doc = Buffer.from(
      "Applicants must be a registered 501(c)(3) nonprofit organization.\nThe narrative must not exceed 300 words and must describe the target population.\n",
      "utf8"
    ).toString("base64");
    const upload = await api(env.app, "POST", `/v1/orgs/${orgId}/channels/${searchChannelId}/files`, {
      token, body: { filename: "announcement.txt", mime: "text/plain", contentBase64: doc },
    });
    expect(upload.status).toBe(201);
    await send(searchChannelId, `Attached: announcement.txt`, upload.body.fileId);

    const res = await send(searchChannelId, "apply for #1");
    const reply = res.body.messages.at(-1);
    expect(reply.body).toContain("set up #");
    grantChannelId = reply.metadata.goToChannelId;
    expect(grantChannelId).toBeTruthy();

    await drainAll();
    const msgs = await messagesOf(grantChannelId);
    // Kickoff + Grace's eligibility pause asking for facts.
    expect(msgs.some((m) => m.body.includes("kicking off our application"))).toBe(true);
    const ask = msgs.find((m) => m.metadata.infoRequest);
    expect(ask).toBeTruthy();
    expect(ask!.metadata.infoRequest).toContain("entity_type");
  });

  it("accepts facts as a chat reply and reaches the bid gate as a message", async () => {
    await send(grantChannelId, "entity_type: 501(c)(3) public charity\nregistration_status: Registered in Ohio");
    await drainAll();
    const msgs = await messagesOf(grantChannelId);
    const bid = msgs.find((m) => m.metadata.approvalKind === "bid_decision");
    expect(bid).toBeTruthy();
    expect(bid!.author_agent).toBe("grant.funding_strategist");
    expect(bid!.body).toContain("/100");
  });

  it('replying "approve" decides the gate and the team continues to the final gate', async () => {
    await send(grantChannelId, "approve");
    await drainAll();
    const msgs = await messagesOf(grantChannelId);
    const final = msgs.find((m) => m.metadata.approvalKind === "final_export");
    expect(final).toBeTruthy();

    await send(grantChannelId, "approve");
    await drainAll();
    const done = await messagesOf(grantChannelId);
    expect(done.some((m) => m.body.includes("package is exported"))).toBe(true);
    expect(done.some((m) => m.body.includes("never guaranteed"))).toBe(true);
  });

  it("builds a website from a sentence: discovery → brief approval → build", async () => {
    const res = await send(mayaDm.id, "Please build a website for our organization");
    const reply = res.body.messages.at(-1);
    const siteChannel = reply.metadata.goToChannelId as string;
    expect(siteChannel).toBeTruthy();
    await drainAll();
    let msgs = await messagesOf(siteChannel);
    // Discovery first: the team asks for what it doesn't know.
    const ask = msgs.find((m) => m.metadata.infoRequest);
    expect(ask).toBeTruthy();
    await send(siteChannel, "programs: Community outreach\nbeneficiaries: Local families\nservice_area: Springfield\nheadquarters: 1 Main St");
    await drainAll();
    msgs = await messagesOf(siteChannel);
    // Then the brief gate — before anything is built.
    expect(msgs.some((m) => m.metadata.approvalKind === "website_brief")).toBe(true);
    expect(msgs.some((m) => m.metadata.approvalKind === "publish_site")).toBe(false);
    await send(siteChannel, "approve");
    await drainAll();
    msgs = await messagesOf(siteChannel);
    expect(msgs.some((m) => m.metadata.approvalKind === "publish_site")).toBe(true);
  });

  it("deduplicates resent messages via clientKey (idempotency)", async () => {
    const key = "test-idem-key-1";
    const first = await api(env.app, "POST", `/v1/orgs/${orgId}/channels/${mayaDm.id}/messages`, {
      token, body: { body: "hello again", clientKey: key },
    });
    expect(first.body.messages.length).toBeGreaterThan(0);
    const retry = await api(env.app, "POST", `/v1/orgs/${orgId}/channels/${mayaDm.id}/messages`, {
      token, body: { body: "hello again", clientKey: key },
    });
    expect(retry.body.messages).toHaveLength(0); // no duplicate work
  });

  it("keeps conversations tenant-isolated", async () => {
    const outsider = await registerUser(env.app, "chat-outsider@example.org");
    const res = await api(env.app, "GET", `/v1/orgs/${orgId}/channels/${mayaDm.id}/messages`, {
      token: outsider.token,
    });
    expect(res.status).toBe(404);
  });
});
