import { useState, type FormEvent } from "react";
import * as api from "../api";
import type { Organization } from "../types";

export function OrgSetupView({
  organizations,
  onSelect,
  onCreated,
}: {
  organizations: Organization[];
  onSelect: (org: Organization) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createOrg(name, slug);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 440 }}>
        <h1 style={{ fontSize: 17 }}>Choose an organization</h1>
        {organizations.length > 0 ? (
          <div style={{ marginBottom: 18 }}>
            {organizations.map((org) => (
              <button
                key={org.id}
                className="nav-item"
                style={{ border: "1px solid var(--border-soft)", marginBottom: 6 }}
                onClick={() => onSelect(org)}
              >
                <span style={{ fontWeight: 600, color: "var(--fg)" }}>{org.name}</span>
                <span className="pill gray" style={{ marginLeft: "auto" }}>{org.role}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">You&rsquo;re not part of any organization yet — create one below.</p>
        )}
        <div className="divider" />
        <h2 style={{ fontSize: 14 }}>Create a new organization</h2>
        <form onSubmit={create}>
          <div className="field">
            <label htmlFor="org-name">Organization name</label>
            <input
              id="org-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
                );
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="org-slug">URL identifier</label>
            <input
              id="org-slug"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="faint mt">Lowercase letters, digits, and hyphens.</p>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}
