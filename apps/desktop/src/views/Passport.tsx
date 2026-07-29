import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type { Organization, PassportStatus } from "../types";
import { Icon } from "../components/Icon";
import { roleAtLeast } from "../roles";

export function PassportView({ org, onBack }: { org: Organization; onBack: () => void }) {
  const [passport, setPassport] = useState<PassportStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = roleAtLeast(org.role, "member");

  useEffect(() => {
    api
      .getPassport(org.id)
      .then(setPassport)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load passport"));
  }, [org.id]);

  const sections = useMemo(() => {
    if (!passport) return [];
    const names = [...new Set(passport.fields.map((f) => f.section))];
    return names.map((name) => ({
      name,
      fields: passport.fields.filter((f) => f.section === name),
    }));
  }, [passport]);

  async function save() {
    const facts = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key, value]) => ({ key, value }));
    if (!facts.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveFacts(org.id, facts);
      const fresh = await api.getPassport(org.id);
      setPassport(fresh);
      setValues({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="main-header">
        <button className="ghost" onClick={onBack} aria-label="Back to grants">← Back</button>
        <h1>Funding Passport</h1>
        {passport && (
          <span className={`pill ${passport.requiredMissing.length ? "amber" : "green"}`}>
            {passport.completeness}% complete
          </span>
        )}
      </header>
      <div className="main-scroll">
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="muted">
          These facts power eligibility checks, bid recommendations, and drafting. Entries you
          save are recorded as <strong>user-certified</strong> evidence with your identity attached.
        </p>
        {sections.map((section) => (
          <div className="card" key={section.name}>
            <h2>{section.name}</h2>
            {section.fields.map((field) => (
              <div className="field" key={field.key}>
                <label htmlFor={`pf-${field.key}`}>
                  {field.label}
                  {field.required && <span style={{ color: "var(--warn)" }}> *</span>}
                </label>
                <input
                  id={`pf-${field.key}`}
                  disabled={!canEdit}
                  placeholder={field.hint ?? ""}
                  value={values[field.key] ?? field.value ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
                {field.value && field.status && (
                  <p className="faint" style={{ marginTop: 3 }}>
                    Recorded as {field.status.replace(/_/g, " ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
        {canEdit && passport && (
          <div className="row" style={{ marginBottom: 30 }}>
            <button className="primary" disabled={busy || Object.keys(values).length === 0} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="pill green"><Icon name="check" size={12} /> Saved</span>}
          </div>
        )}
      </div>
    </>
  );
}
