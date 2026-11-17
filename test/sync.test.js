import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openDb, saveRules, DEFAULT_RULES } from "../src/db.js";
import { makeCipher, hashPassword } from "../src/crypto.js";
import { createMockClient } from "../src/dropi/mock.js";
import { syncUser } from "../src/sync.js";

function setup(mockOpts) {
  const db = openDb(":memory:");
  const cipher = makeCipher(crypto.randomBytes(32).toString("base64"));
  const dropi = createMockClient(mockOpts);
  const { id } = db.prepare("INSERT INTO users (email, name, password_hash) VALUES ('t@x.mx','T',?) RETURNING id").get(hashPassword("x"));
  db.prepare("INSERT INTO dropi_connections (user_id, email, password_enc, token_enc, status) VALUES (?, 't@x.mx', ?, ?, 'connected')")
    .run(id, cipher.encrypt("pw"), cipher.encrypt("mock-token"));
  return { db, cipher, dropi, userId: id, tarifa: 170 };
}

test("toma solo pedidos en zona y en estados elegidos, y los cancela en Dropi", async () => {
  const ctx = setup();
  const r = await syncUser(ctx);
  const taken = r.events.filter((e) => e.taken).map((e) => e.dropiId).sort();
  assert.deepEqual(taken, ["51201", "51202", "51204", "51208"]);
  for (const id of taken) assert.equal(ctx.dropi.orders.find((o) => o.dropiId === id).estadoDropi, "CANCELADO");
  assert.equal(ctx.dropi.orders.find((o) => o.dropiId === "51203").estadoDropi, "PENDIENTE"); // Saltillo se queda
  const rows = ctx.db.prepare("SELECT dropi_id, dropi_cancel, tarifa FROM orders").all();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => x.dropi_cancel === "cancelado" && x.tarifa === 170));
});

test("no duplica pedidos en una segunda revisión", async () => {
  const ctx = setup();
  await syncUser(ctx);
  ctx.dropi.orders.forEach((o) => { if (o.estadoDropi === "CANCELADO") o.estadoDropi = "PENDIENTE"; });
  const r = await syncUser(ctx);
  assert.equal(r.tomados, 0);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM orders").get().n, 4);
});

test("respeta municipios desactivados y la opción de no cancelar", async () => {
  const ctx = setup();
  saveRules(ctx.db, ctx.userId, { ...DEFAULT_RULES, municipios: ["monterrey"], cancelar: false });
  const r = await syncUser(ctx);
  assert.deepEqual(r.events.filter((e) => e.taken).map((e) => e.dropiId), ["51201"]);
  assert.equal(ctx.dropi.orders.find((o) => o.dropiId === "51201").estadoDropi, "PENDIENTE");
});

test("si Dropi no deja cancelar, el pedido se guarda y queda marcado con error", async () => {
  const ctx = setup({ failCancelFor: ["51204"] });
  await syncUser(ctx);
  const row = ctx.db.prepare("SELECT dropi_cancel, dropi_cancel_error FROM orders WHERE dropi_id = '51204'").get();
  assert.equal(row.dropi_cancel, "error");
  assert.match(row.dropi_cancel_error, /no permitió/);
});

test("sesión de Dropi vencida marca la conexión como expirada", async () => {
  const ctx = setup();
  ctx.dropi.listOrders = async () => { const e = new Error("La sesión de Dropi venció"); e.code = "expired"; throw e; };
  const r = await syncUser(ctx);
  assert.match(r.error, /venció/);
  assert.equal(ctx.db.prepare("SELECT status FROM dropi_connections").get().status, "expired");
});
