import { config } from "./config.js";
import { openDb } from "./db.js";
import { makeCipher } from "./crypto.js";
import { createApp } from "./app.js";
import { createLiveClient } from "./dropi/client.js";
import { createMockClient } from "./dropi/mock.js";
import { syncDue } from "./sync.js";

const db = openDb(config.databasePath);
const cipher = makeCipher(config.encryptionKey);
const dropi = config.dropi.mode === "live" ? createLiveClient(config.dropi) : createMockClient();
const app = createApp({ db, dropi, cipher, config });

app.listen(config.port, () => {
  console.log(`Avirofy escuchando en http://localhost:${config.port} (Dropi: ${config.dropi.mode})`);
});

// Revisión automática: cada minuto mira qué dropshippers ya cumplieron su frecuencia
if (config.syncEveryMinutes > 0) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncDue({ db, dropi, cipher, tarifa: config.tarifa });
      for (const x of r) console.log(`[sync] usuario ${x.userId}: ${x.tomados ?? 0} tomados de ${x.revisados ?? 0}${x.error ? " · " + x.error : ""}`);
    } catch (e) { console.error("[sync]", e); } finally { running = false; }
  }, 60_000);
}
