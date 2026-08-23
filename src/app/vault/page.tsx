"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, LockKeyhole, LogOut, Plus, RotateCw, Search, ShieldCheck } from "lucide-react";
import { TopBar } from "@/components/top-bar";

type VaultEntry = {
  service: string;
  keyName: string;
  revision: number;
  description: string | null;
  scopes: string[];
  aliases: string[];
  sourceFiles: string[];
};

type VaultForm = {
  service: string;
  keyName: string;
  value: string;
  description: string;
};

const emptyForm: VaultForm = {
  service: "",
  keyName: "",
  value: "",
  description: "",
};

async function readResponse(response: Response): Promise<{ error?: string; entries?: VaultEntry[] }> {
  const payload: unknown = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" ? payload as { error?: string; entries?: VaultEntry[] } : {};
}

export default function VaultPage() {
  const [password, setPassword] = useState("");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [form, setForm] = useState<VaultForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    const response = await fetch("/api/vault", { cache: "no-store" });
    const payload = await readResponse(response);
    if (response.status === 401) {
      setAuthenticated(false);
      setEntries([]);
      return false;
    }
    if (!response.ok) {
      setMessage(payload.error ?? "Vault metadata is unavailable right now.");
      return false;
    }
    setEntries(payload.entries ?? []);
    setAuthenticated(true);
    return true;
  }, []);

  useEffect(() => {
    // Defer the initial network check so this effect only subscribes to an
    // external async operation rather than synchronously cascading a render.
    const timer = window.setTimeout(() => {
      void loadEntries().finally(() => setChecking(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEntries]);

  const existingEntry = useMemo(
    () => entries.find((entry) => entry.service === form.service.trim() && entry.keyName === form.keyName.trim()),
    [entries, form.keyName, form.service],
  );

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => [
      entry.service,
      entry.keyName,
      entry.description ?? "",
      ...entry.scopes,
      ...entry.aliases,
      ...entry.sourceFiles,
    ].some((value) => value.toLowerCase().includes(query)));
  }, [entries, search]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/vault/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await readResponse(response);
      if (!response.ok) {
        setMessage(payload.error ?? "Could not unlock the vault.");
        return;
      }
      setPassword("");
      setMessage(null);
      await loadEntries();
    } catch {
      setMessage("Could not unlock the vault right now.");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: form.service,
          keyName: form.keyName,
          value: form.value,
          description: form.description || undefined,
        }),
      });
      const payload = await readResponse(response);
      if (!response.ok) {
        setMessage(payload.error ?? "The key could not be saved.");
        return;
      }
      const action = existingEntry ? "rotated" : "saved";
      setForm((current) => ({ ...current, value: "" }));
      setMessage(`Key ${action}. Its value is not displayed or retained in this page.`);
      await loadEntries();
    } catch {
      setMessage("The key could not be saved right now.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/vault/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword, confirmation: passwordConfirmation }),
      });
      const payload = await readResponse(response);
      if (!response.ok) {
        setMessage(payload.error ?? "The vault password could not be changed.");
        return;
      }
      setNewPassword("");
      setPasswordConfirmation("");
      setMessage("Vault password changed. Your current session remains open.");
    } catch {
      setMessage("The vault password could not be changed right now.");
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    await fetch("/api/vault/session", { method: "DELETE" });
    setAuthenticated(false);
    setEntries([]);
    setForm(emptyForm);
    setMessage(null);
  }

  const update = (field: keyof VaultForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  return (
    <main className="min-h-dvh" data-jarvis-app="project-hub" data-jarvis-page="vault-control">
      <TopBar />
      <section className="max-w-[1120px] mx-auto px-6 lg:px-10 py-10 lg:py-14">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass mb-3">Owner control</p>
            <h1 className="font-display text-4xl text-paper tracking-tight">Key vault</h1>
            <p className="mt-2 max-w-2xl text-sm text-paper-dim">Add or rotate service credentials without ever viewing a saved secret in the Project Hub.</p>
          </div>
          <Link href="/" className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint hover:text-brass">Back to dashboard</Link>
        </div>

        {message && <p role="status" className="mb-5 rounded-lg border border-brass/30 bg-brass/[0.07] px-4 py-3 text-sm text-paper">{message}</p>}

        {checking ? (
          <div className="rounded-xl border border-rule-soft bg-ink-2/40 px-5 py-8 text-sm text-paper-dim">Checking owner access…</div>
        ) : !authenticated ? (
          <div className="max-w-md rounded-xl border border-rule-soft bg-ink-2/40 p-6 shadow-2xl shadow-black/20">
            <div className="mb-5 flex items-center gap-3 text-brass"><LockKeyhole className="w-5 h-5" /><span className="font-mono text-[10px] uppercase tracking-[0.22em]">Unlock vault control</span></div>
            <form onSubmit={signIn} className="space-y-4">
              <label className="block text-sm text-paper-dim">Vault password
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required className="mt-2 w-full rounded-md border border-rule-soft bg-ink px-3 py-2.5 text-paper outline-none focus:border-brass" />
              </label>
              <button disabled={submitting} className="inline-flex items-center gap-2 rounded-md bg-brass px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-60"><KeyRound className="w-4 h-4" />{submitting ? "Unlocking…" : "Unlock vault"}</button>
            </form>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
            <section className="rounded-xl border border-rule-soft bg-ink-2/40 p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4"><div><h2 className="font-display text-2xl text-paper">Saved key metadata</h2><p className="mt-1 text-xs text-paper-faint">{entries.length} {entries.length === 1 ? "key" : "keys"} · values are never shown</p></div><button onClick={() => void signOut()} className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint hover:text-rose-soft"><LogOut className="w-3.5 h-3.5" />Lock</button></div>
              <label className="relative mb-3 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-faint" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service, key, scope, or source" type="search" className="w-full rounded-md border border-rule-soft bg-ink py-2 pl-9 pr-3 text-sm text-paper outline-none placeholder:text-paper-faint focus:border-brass" />
              </label>
              <details className="mb-4 rounded-md border border-rule-soft/70 px-3 py-2">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.15em] text-paper-faint hover:text-brass">Change vault password</summary>
                <form onSubmit={changePassword} className="mt-3 space-y-3">
                  <p className="text-xs text-paper-faint">Choose at least 16 characters. The password is never shown after you save it.</p>
                  <label className="block text-xs text-paper-dim">New password<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={16} required className="mt-1.5 w-full rounded-md border border-rule-soft bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-brass" /></label>
                  <label className="block text-xs text-paper-dim">Confirm new password<input value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" minLength={16} required className="mt-1.5 w-full rounded-md border border-rule-soft bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-brass" /></label>
                  <button disabled={submitting} className="inline-flex items-center gap-2 rounded-md border border-brass/45 px-3 py-2 text-sm font-medium text-brass disabled:opacity-60"><RotateCw className="w-3.5 h-3.5" />{submitting ? "Saving…" : "Change password"}</button>
                </form>
              </details>
              <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                {filteredEntries.map((entry) => <article key={`${entry.service}/${entry.keyName}`} className="rounded-lg border border-rule-soft/70 bg-ink/55 px-4 py-3"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs text-paper">{entry.service}<span className="text-paper-faint"> / </span>{entry.keyName}</p>{entry.description && <p className="mt-1 text-xs text-paper-dim">{entry.description}</p>}</div><span className="shrink-0 rounded border border-rule-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-paper-faint">v{entry.revision}</span></div>{entry.scopes.length > 0 && <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-paper-faint">{entry.scopes.join(" · ")}</p>}</article>)}
                {entries.length === 0 && <p className="rounded-lg border border-dashed border-rule-soft px-4 py-8 text-center text-sm text-paper-faint">No key metadata yet.</p>}
                {entries.length > 0 && filteredEntries.length === 0 && <p className="rounded-lg border border-dashed border-rule-soft px-4 py-8 text-center text-sm text-paper-faint">No saved key metadata matches this search.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-brass/25 bg-ink-2/55 p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3"><span className="grid w-9 h-9 place-items-center rounded-lg bg-brass/[0.12] text-brass"><ShieldCheck className="w-4 h-4" /></span><div><h2 className="font-display text-2xl text-paper">Add a secret</h2><p className="text-xs text-paper-faint">Four fields only. Saving the same provider and key name rotates it.</p></div></div>
              <form onSubmit={saveEntry} className="space-y-3">
                <div className="grid grid-cols-2 gap-3"><label className="text-xs text-paper-dim">Provider<input value={form.service} onChange={update("service")} required list="vault-providers" placeholder="huggingface" className="mt-1.5 w-full rounded-md border border-rule-soft bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-brass" /></label><label className="text-xs text-paper-dim">Key name<input value={form.keyName} onChange={update("keyName")} required placeholder="HF_API_KEY" className="mt-1.5 w-full rounded-md border border-rule-soft bg-ink px-3 py-2 font-mono text-sm text-paper outline-none focus:border-brass" /></label></div>
                <datalist id="vault-providers"><option value="huggingface" /><option value="novita" /><option value="openai" /><option value="github" /><option value="stripe" /></datalist>
                <label className="block text-xs text-paper-dim">Secret value<textarea value={form.value} onChange={update("value")} required rows={4} autoComplete="new-password" spellCheck={false} className="mt-1.5 w-full resize-y rounded-md border border-rule-soft bg-ink px-3 py-2 font-mono text-xs text-paper outline-none focus:border-brass" /></label>
                <label className="block text-xs text-paper-dim">What is this for? <span className="text-paper-faint">(optional)</span><input value={form.description} onChange={update("description")} placeholder="Lito Music — gated LTX model downloads" className="mt-1.5 w-full rounded-md border border-rule-soft bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-brass" /></label>
                <button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brass px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60">{existingEntry ? <RotateCw className="w-4 h-4" /> : <Plus className="w-4 h-4" />}{submitting ? "Saving…" : existingEntry ? "Rotate key" : "Save key"}</button>
              </form>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
