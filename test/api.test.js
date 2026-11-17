import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openDb } from "../src/db.js";
import { makeCipher, hashPassword } from "../src/crypto.js";
import { createMockClient } from "../src/dropi/mock.js";
import { createApp } from "../src/app.js";

test("flujo completo: entrar, conectar Dropi con código, sincronizar y ver pedidos", async (t) => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES ('tienda@ejemplo.mx','Tienda',?)").run(hashPassword("secreta123"));
  const cipher = makeCipher(crypto.randomBytes(32).toString("base64"));
  const app = createApp({ db, dropi: createMockClient(), cipher, config: { tarifa: 170, production: false } });
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: r.status, body: await r.json() };
  };

  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("POST", "/api/login", { email: "tienda@ejemplo.mx", password: "mal" })).status, 401);
  assert.equal((await call("POST", "/api/login", { email: "TIENDA@ejemplo.mx", password: "secreta123" })).status, 200);
  assert.equal((await call("GET", "/api/me")).body.tarifa, 170);

  assert.equal((await call("POST", "/api/sync")).status, 400); // sin Dropi
  assert.equal((await call("POST", "/api/dropi/login", { email: "d@x.mx", password: "dropi123" })).body.status, "needs_code");
  assert.equal((await call("POST", "/api/dropi/verify", { code: "000000" })).status, 400);
  assert.equal((await call("POST", "/api/dropi/verify", { code: "123456" })).body.status, "connected");

  // La contraseña de Dropi nunca se guarda en claro
  const c = db.prepare("SELECT password_enc FROM dropi_connections").get();
  assert.ok(!c.password_enc.includes("dropi123"));

  const s = await call("POST", "/api/sync");
  assert.equal(s.body.tomados, 4);
  assert.equal((await call("GET", "/api/orders")).body.length, 4);

  assert.equal((await call("POST", "/api/orders", { cliente: "A", direccion: "B", municipio: "Saltillo", cp: "25000" })).status, 400);
  assert.equal((await call("POST", "/api/orders", { cliente: "A", direccion: "Calle 1", municipio: "Monterrey", cp: "64000", cod: 300 })).status, 201);

  await call("POST", "/api/logout");
  assert.equal((await call("GET", "/api/me")).status, 401);
});
