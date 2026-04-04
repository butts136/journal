import { NextResponse } from "next/server";

import { issueAdminSession, verifyAdminPassword } from "@/lib/auth";
import { isApplicationConfigured } from "@/lib/store";

export async function POST(request: Request) {
  if (!isApplicationConfigured()) {
    return NextResponse.json(
      { error: "L'application n'est pas initialisee." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as { password?: string };
  const password = body.password?.trim() ?? "";

  if (!(await verifyAdminPassword(password))) {
    return NextResponse.json({ error: "Mot de passe invalide." }, { status: 401 });
  }

  await issueAdminSession();
  return NextResponse.json({ ok: true });
}
