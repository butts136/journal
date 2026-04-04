import fs from "node:fs";
import path from "node:path";

import { ensureDir } from "@/lib/utils";

type WebTorrentClient = {
  add: (
    torrentId: string,
    opts: Record<string, unknown>,
    cb: (torrent: {
      infoHash: string;
      name: string;
      files: Array<{
        name: string;
        length: number;
        select: () => void;
        createReadStream: () => fs.ReadStream;
      }>;
      on: (event: string, listener: (error: Error) => void) => void;
    }) => void,
  ) => void;
  remove: (torrentId: string, cb?: () => void) => void;
};

declare global {
  var __journalTorrentClientPromise: Promise<WebTorrentClient> | undefined;
}

async function getTorrentClient() {
  if (!global.__journalTorrentClientPromise) {
    global.__journalTorrentClientPromise = (async () => {
      const { default: WebTorrent } = await import("webtorrent");
      return new WebTorrent() as WebTorrentClient;
    })();
  }

  return global.__journalTorrentClientPromise;
}

export async function downloadLargestPdfFromTorrent(sourceUrl: string, outputPath: string) {
  const client = await getTorrentClient();
  await ensureDir(path.dirname(outputPath));

  return new Promise<{ bytes: number; fileName: string }>((resolve, reject) => {
    let settled = false;
    let currentInfoHash = "";

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (currentInfoHash) {
        client.remove(currentInfoHash, () => reject(error));
        return;
      }

      reject(error);
    };

    client.add(sourceUrl, { destroyStoreOnDestroy: true }, (torrent) => {
      currentInfoHash = torrent.infoHash;
      torrent.on("error", fail);

      const selectedPdf = torrent.files
        .filter((file) => file.name.toLowerCase().endsWith(".pdf"))
        .toSorted((left, right) => right.length - left.length)[0];

      if (!selectedPdf) {
        fail(new Error("Aucun fichier PDF n'a été trouvé dans ce torrent."));
        return;
      }

      selectedPdf.select();

      const readStream = selectedPdf.createReadStream();
      const writeStream = fs.createWriteStream(outputPath);

      readStream.on("error", fail);
      writeStream.on("error", fail);
      writeStream.on("finish", () => {
        if (settled) {
          return;
        }

        settled = true;
        const bytes = fs.statSync(outputPath).size;
        client.remove(torrent.infoHash, () =>
          resolve({
            bytes,
            fileName: selectedPdf.name,
          }),
        );
      });

      readStream.pipe(writeStream);
    });
  });
}
