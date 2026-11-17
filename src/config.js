import fs from "node:fs";

// Carga .env sin dependencias (solo claves que no estén ya definidas)
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env;
export const config = {
  port: Number(env.PORT || 3000),
  production: env.NODE_ENV === "production",
  databasePath: env.DATABASE_PATH || "./data/avirofy.db",
  encryptionKey: env.ENCRYPTION_KEY || "",
  tarifa: Number(env.TARIFA_MXN || 170),
  syncEveryMinutes: Number(env.SYNC_EVERY_MINUTES ?? 15),
  dropi: {
    mode: env.DROPI_MODE || "mock",
    base: env.DROPI_API_BASE || "https://api.dropi.co/api",
    whiteBrandId: env.DROPI_WHITE_BRAND_ID || "",
    paths: {
      login: env.DROPI_PATH_LOGIN || "/login",
      verify: env.DROPI_PATH_VERIFY || "/login/verify",
      orders: env.DROPI_PATH_ORDERS || "/orders/myorders",
      cancel: env.DROPI_PATH_CANCEL || "/orders/myorders/:id",
    },
  },
};
