"use client";

import { useState, useTransition } from "react";

export function SetupForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 10) {
      setError("Le mot de passe doit contenir au moins 10 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Initialisation impossible.");
        return;
      }

      window.location.href = "/settings";
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium text-stone-700">Mot de passe administrateur</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-2xl border border-stone-300 bg-white/90 px-4 py-3 outline-none ring-0 transition focus:border-stone-500"
          placeholder="Au moins 10 caracteres"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-stone-700">Confirmation</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-2xl border border-stone-300 bg-white/90 px-4 py-3 outline-none ring-0 transition focus:border-stone-500"
          placeholder="Retape le mot de passe"
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Configuration en cours…" : "Verrouiller les parametres"}
      </button>
    </form>
  );
}
