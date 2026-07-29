import { useState, type FormEvent } from "react";
import * as api from "../api";

export function LoginView({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, displayName || email.split("@")[0] || "User");
      api.setToken(res.token);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">D</span>&nbsp;<strong>Deedwell</strong>
        </div>
        <h1 style={{ textAlign: "center", fontSize: 17 }}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="muted" style={{ textAlign: "center", marginBottom: 20 }}>
          Your nonprofit&rsquo;s AI-powered team workspace
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {mode === "register" && <p className="faint mt">At least 10 characters.</p>}
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              New to Deedwell?
              <button onClick={() => { setMode("register"); setError(null); }}>Create an account</button>
            </>
          ) : (
            <>
              Already have an account?
              <button onClick={() => { setMode("login"); setError(null); }}>Sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
