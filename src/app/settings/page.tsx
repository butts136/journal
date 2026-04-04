import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/components/admin-login-form";
import { SettingsPanel } from "@/components/settings-panel";
import { isAdminAuthenticated } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import {
  getAllFeeds,
  getAllSearchTerms,
  getStatusSnapshot,
  isApplicationConfigured,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureBootstrap();

  if (!isApplicationConfigured()) {
    redirect("/setup");
  }

  const authenticated = await isAdminAuthenticated();

  return (
    <div className="space-y-8">
      <section className="rounded-[34px] border border-white/60 bg-white/84 p-8 shadow-[0_30px_100px_rgba(48,38,23,0.08)]">
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-stone-500">Paramètres</p>
        <h1 className="mt-3 font-serif text-5xl text-stone-900">Centre de contrôle</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-600">
          Gère les expressions surveillées, les flux RSS et déclenche une vérification manuelle sans
          attendre le prochain cycle automatique.
        </p>
      </section>

      {authenticated ? (
        <SettingsPanel
          feeds={getAllFeeds()}
          searchTerms={getAllSearchTerms()}
          stats={getStatusSnapshot()}
        />
      ) : (
        <div className="mx-auto max-w-2xl rounded-[34px] border border-white/60 bg-white/84 p-8 shadow-[0_30px_100px_rgba(48,38,23,0.08)]">
          <h2 className="font-serif text-4xl text-stone-900">Zone protégée</h2>
          <p className="mt-3 text-base leading-8 text-stone-600">
            Entre le mot de passe administrateur pour modifier les termes recherchés et les sources
            RSS surveillées.
          </p>

          <div className="mt-8 rounded-[28px] border border-stone-200 bg-stone-50/70 p-6">
            <AdminLoginForm />
          </div>
        </div>
      )}
    </div>
  );
}
