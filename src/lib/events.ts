const encoder = new TextEncoder();

declare global {
  var __journalEventClients:
    | Map<number, ReadableStreamDefaultController<Uint8Array>>
    | undefined;
  var __journalEventClientId: number | undefined;
}

function getClients() {
  if (!global.__journalEventClients) {
    global.__journalEventClients = new Map();
    global.__journalEventClientId = 0;
  }

  return global.__journalEventClients;
}

function removeClient(id: number) {
  getClients().delete(id);
}

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  type: string,
  payload: unknown,
) {
  controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
}

export function openEventStream() {
  let heartbeat: NodeJS.Timeout | undefined;
  let clientId = -1;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      clientId = (global.__journalEventClientId ?? 0) + 1;
      global.__journalEventClientId = clientId;
      getClients().set(clientId, controller);
      writeEvent(controller, "connected", { ok: true });

      heartbeat = setInterval(() => {
        try {
          writeEvent(controller, "ping", { time: Date.now() });
        } catch {
          removeClient(clientId);
          clearInterval(heartbeat);
        }
      }, 25000);
    },
    cancel() {
      removeClient(clientId);

      if (heartbeat) {
        clearInterval(heartbeat);
      }
    },
  });
}

export function broadcastEvent(type: string, payload: unknown) {
  for (const [clientId, controller] of getClients()) {
    try {
      writeEvent(controller, type, payload);
    } catch {
      removeClient(clientId);
    }
  }
}
