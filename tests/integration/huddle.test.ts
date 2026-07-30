import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createOrg, createTestEnv, registerUser, type TestEnv } from "../helpers.js";

/** Phase 6: huddles as a voice layer over the real channel pipeline. */

let env: TestEnv;
let token: string;
let orgId: string;
let mayaDm: string;

beforeAll(async () => {
  env = await createTestEnv();
  ({ token } = await registerUser(env.app, "huddle@example.org"));
  orgId = await createOrg(env.app, token, "huddle-org");
  const channels = await api(env.app, "GET", `/v1/orgs/${orgId}/channels`, { token });
  mayaDm = channels.body.channels.find((c: any) => c.key === "dm:core.executive_assistant").id;
});
afterAll(async () => {
  await env.close();
});

describe("huddles", () => {
  let huddleId: string;

  it("starts a huddle with the channel's natural participants and a facilitator message", async () => {
    const res = await api(env.app, "POST", `/v1/orgs/${orgId}/huddles`, {
      token, body: { channelId: mayaDm },
    });
    expect(res.status).toBe(201);
    huddleId = res.body.huddleId;
    expect(res.body.participants).toContain("core.executive_assistant");
    const msgs = await api(env.app, "GET", `/v1/orgs/${orgId}/channels/${mayaDm}/messages`, { token });
    const started = msgs.body.messages.find((m: any) => m.metadata.huddleEvent === "started");
    expect(started.body).toContain("huddle");
  });

  it("re-starting returns the same active huddle (no duplicates)", async () => {
    const res = await api(env.app, "POST", `/v1/orgs/${orgId}/huddles`, {
      token, body: { channelId: mayaDm },
    });
    expect(res.body.huddleId).toBe(huddleId);
    expect(res.body.resumed).toBe(true);
  });

  it("utterances flow through the REAL agent pipeline, tagged to the huddle", async () => {
    const res = await api(env.app, "POST", `/v1/orgs/${orgId}/channels/${mayaDm}/messages`, {
      token, body: { body: "hello team", huddleId },
    });
    const reply = res.body.messages.at(-1);
    expect(reply.author_kind).toBe("agent");
    expect(reply.metadata.huddleId).toBe(huddleId);
    expect(reply.body).toContain("Maya");
  });

  it("ending posts a summary with the transcript into the channel", async () => {
    const res = await api(env.app, "POST", `/v1/orgs/${orgId}/huddles/${huddleId}/end`, {
      token, body: {},
    });
    expect(res.status).toBe(200);
    const msgs = await api(env.app, "GET", `/v1/orgs/${orgId}/channels/${mayaDm}/messages`, { token });
    const summary = msgs.body.messages.find((m: any) => m.metadata.huddleEvent === "ended");
    expect(summary.body).toContain("Huddle summary");
    expect(summary.body).toContain("You: hello team");
    const again = await api(env.app, "POST", `/v1/orgs/${orgId}/huddles/${huddleId}/end`, { token, body: {} });
    expect(again.status).toBe(404); // already ended — honest
  });

  it("voice endpoint reports honestly when synthesis is disabled", async () => {
    const res = await api(env.app, "GET",
      `/v1/orgs/${orgId}/tts?agent=core.executive_assistant&text=hello`, { token });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("disabled");
  });

  it("huddles are tenant-isolated", async () => {
    const outsider = await registerUser(env.app, "huddle-outsider@example.org");
    const res = await api(env.app, "POST", `/v1/orgs/${orgId}/huddles`, {
      token: outsider.token, body: { channelId: mayaDm },
    });
    expect(res.status).toBe(404);
  });
});
