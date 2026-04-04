import path from "node:path";

import { STORAGE_ROOT } from "@/lib/constants";
import { ensureDir } from "@/lib/utils";

export function getStorageRoot() {
  return STORAGE_ROOT;
}

export async function ensureStorageStructure() {
  await ensureDir(STORAGE_ROOT);
  await ensureDir(path.join(process.cwd(), "data"));
}

export function buildJournalStoragePaths(publicationKey: string, dateKey: string) {
  const relativeDir = path.posix.join("journals", publicationKey, dateKey);
  const absoluteDir = path.join(STORAGE_ROOT, relativeDir);

  return {
    relativeDir,
    absoluteDir,
    pdfRelativePath: path.posix.join(relativeDir, "journal.pdf"),
    pdfAbsolutePath: path.join(absoluteDir, "journal.pdf"),
    thumbnailRelativePath: path.posix.join(relativeDir, "thumb.png"),
    thumbnailAbsolutePath: path.join(absoluteDir, "thumb.png"),
  };
}

export function resolveManagedPath(relativePath: string) {
  const absolutePath = path.resolve(STORAGE_ROOT, relativePath);
  const root = path.resolve(STORAGE_ROOT);

  if (!absolutePath.startsWith(root)) {
    throw new Error("Chemin hors du stockage géré.");
  }

  return absolutePath;
}

export function toManagedFileUrl(relativePath: string | null) {
  if (!relativePath) {
    return null;
  }

  return `/api/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}
