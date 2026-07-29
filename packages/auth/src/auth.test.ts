import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  roleAtLeast,
  verifyPassword,
} from "./index.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter2", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces unique salts", async () => {
    const [a, b] = await Promise.all([hashPassword("same-pass-123"), hashPassword("same-pass-123")]);
    expect(a).not.toEqual(b);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("session tokens", () => {
  it("stores only a hash that maps back deterministically", () => {
    const { token, tokenHash } = generateSessionToken();
    expect(token).not.toContain(tokenHash);
    expect(hashSessionToken(token)).toBe(tokenHash);
  });
});

describe("role hierarchy", () => {
  it("orders viewer < member < admin < owner", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "member")).toBe(false);
  });
});
