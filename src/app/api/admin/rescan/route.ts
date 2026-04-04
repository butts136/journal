import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/auth";
import { ensureBootstrap, triggerScanNow } from "@/lib/bootstrap";

export async function POST() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Acces refuse." }, { status: 401 });
  }

  await ensureBootstrap();
  await triggerScanNow();

  return NextResponse.json({ ok: true });
}
