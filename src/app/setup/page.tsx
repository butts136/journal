import { redirect } from "next/navigation";

import { SetupForm } from "@/components/setup-form";
import { isApplicationConfigured } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (isApplicationConfigured()) {
    redirect("/settings");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-[36px] border border-white/60 bg-white/86 p-8 shadow-[0_30px_100px_rgba(48,38,23,0.09)] sm:p-10">
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-stone-500">Premier lancement</p>
        <h1 className="mt-4 font-serif text-5xl text-stone-900">Sécurise l&apos;espace admin</h1>
        <p className="mt-4 max-w-2xl text-base leading-8 text-stone-600">
          Choisis le mot de passe qui verrouillera l&apos;onglet Paramètres. Il sera stocké sous forme
          chiffrée et servira à protéger l&apos;administration du kiosque.
        </p>

        <div className="mt-8 rounded-[28px] border border-stone-200 bg-stone-50/70 p-6">
          <SetupForm />
        </div>
      </div>
    </div>
  );
}
