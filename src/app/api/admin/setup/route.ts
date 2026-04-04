import { NextResponse } from "next/server";

import { setupAdminPassword } from "@/lib/auth";
import { isApplicationConfigured } from "@/lib/store";

export async function POST(request: Request) {
  if (isApplicationConfigured()) {
    return NextResponse.json(
      { error: "Le mot de passe administrateur est deja configure." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as { password?: string };
  const password = body.password?.trim() ?? "";

  if (password.length < 10) {
    return NextResponse.json(
      { error: "Le mot de passe doit contenir au moins 10 caracteres." },
      { status: 400 },
    );
  }

  await setupAdminPassword(password);
  return NextResponse.json({ ok: true });
}
