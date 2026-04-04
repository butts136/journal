import crypto from "node:crypto";

import argon2 from "argon2";
import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME } from "@/lib/constants";
import { getAppConfig, isApplicationConfigured, setAdminPasswordHash } from "@/lib/store";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = {
  role: "admin";
  exp: number;
};

function signPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeSession(payload: SessionPayload, secret: string) {
  const serialized = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(serialized, secret);
  return `${serialized}.${signature}`;
}

function decodeSession(token: string, secret: string) {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload, secret);

  if (signature.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;

  if (decoded.exp < Date.now()) {
    return null;
  }

  return decoded;
}

export async function setupAdminPassword(password: string) {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    parallelism: 1,
    timeCost: 2,
  });

  setAdminPasswordHash(hash);
  await issueAdminSession();
}

export async function verifyAdminPassword(password: string) {
  const { adminPasswordHash } = getAppConfig();

  if (!adminPasswordHash) {
    return false;
  }

  return argon2.verify(adminPasswordHash, password);
}

export async function issueAdminSession() {
  const cookieStore = await cookies();
  const { sessionSecret } = getAppConfig();
  const token = encodeSession(
    {
      role: "admin",
      exp: Date.now() + SESSION_DURATION_SECONDS * 1000,
    },
    sessionSecret,
  );

  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}

export async function isAdminAuthenticated() {
  if (!isApplicationConfigured()) {
    return false;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return false;
  }

  const { sessionSecret } = getAppConfig();
  const payload = decodeSession(token, sessionSecret);

  return payload?.role === "admin";
}
