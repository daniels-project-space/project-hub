"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export default function MediaEngineLaunch() {
  const [needsLogin, setNeedsLogin] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  async function launch() {
    const response = await fetch("/api/vault/media-engine/access", {
      method: "POST",
      credentials: "same-origin",
    });
    const body = await response.json();
    if (response.status === 401) {
      setNeedsLogin(true);
      setBusy(false);
      return;
    }
    if (!response.ok)
      throw new Error(body.error || "Could not open Media Engine");
    const url = new URL(body.url);
    if (
      url.origin !== "https://media-engine-seven.vercel.app" ||
      url.pathname !== "/operator/access"
    )
      throw new Error("Unexpected workspace destination");
    window.location.replace(url.href);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void launch().catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not open Media Engine",
        );
        setBusy(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/vault/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: new FormData(form).get("password") }),
      });
      form.reset();
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Owner login failed");
      }
      await launch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect");
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <section className="w-full max-w-md rounded-2xl border border-rule-soft bg-ink/90 p-8 shadow-2xl">
        <div className="mb-6 grid size-12 place-items-center rounded-xl bg-lime-200 text-2xl font-bold text-black">
          ✱
        </div>
        <p className="text-xs uppercase tracking-widest text-paper-faint">
          Project Hub / Private workspace
        </p>
        <h1 className="mt-3 font-display text-4xl">Media Engine</h1>
        <p className="mt-3 text-sm leading-6 text-paper-dim">
          {needsLogin
            ? "Use your existing Project Hub owner password to open your marketing workspace."
            : "Connecting your marketing workspace…"}
        </p>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-rose-400/40 p-3 text-sm text-rose-200"
          >
            {error}
          </p>
        )}
        {needsLogin ? (
          <form className="mt-6 grid gap-4" onSubmit={login}>
            <label className="grid gap-2 text-sm">
              Owner password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                autoFocus
                className="min-h-12 rounded-lg border border-rule-soft bg-black/20 px-3 text-paper outline-none focus:border-lime-200"
              />
            </label>
            <button
              disabled={busy}
              className="min-h-12 rounded-lg bg-lime-200 px-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Open marketing workspace →"}
            </button>
          </form>
        ) : (
          error && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void launch().catch((cause) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not connect",
                  );
                  setBusy(false);
                });
              }}
              className="mt-6 rounded-lg bg-lime-200 px-5 py-3 text-sm text-black"
            >
              Try again
            </button>
          )
        )}
        <Link
          href="/"
          className="mt-6 inline-block text-xs text-paper-faint underline"
        >
          Back to Project Hub
        </Link>
      </section>
    </main>
  );
}
