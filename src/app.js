import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCoverage, MUNICIPIOS } from "./coverage.js";
import { getRules, saveRules } from "./db.js";
import { hashPassword, verifyPassword, randomToken } from "./crypto.js";
import { syncUser } from "./sync.js";

const ESTADOS_DROPI = ["PENDIENTE CONFIRMACION", "PENDIENTE", "GUIA_GENERADA"];
const ORDER_STATUS = ["recibido", "bodega", "ruta", "entregado", "novedad", "cancelado"];
const SESSION_DAYS = 7;

export function createApp({ db, dropi, cipher, config }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public")));

  // ---------- Sesión ----------
  const cookieName = "avf_session";
  const readCookie = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]))[cookieName];
  const setCookie = (res, value, maxAgeSec) => res.setHeader("Set-Cookie",
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${config.production ? "; Secure" : ""}`);

  function auth(req, res, next) {
    const token = readCookie(req);
    const s = token && db.prepare("SELECT u.id, u.email, u.name, u.role, u.must_change_password FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')").get(token);
    if (!s) return res.status(401).json({ error: "Tu sesión terminó. Vuelve a entrar." });
    req.user = s;
    next();
  }

  // Límite simple de intentos de acceso: 10 por correo cada 15 minutos
  const attempts = new Map();
  function tooMany(key) {
    const now = Date.now(), a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60_000);
    a.push(now); attempts.set(key, a);
    return a.length > 10;
  }

  app.post("/api/login", (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase(), password = String(req.body?.password || "");
    if (tooMany(email)) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!u || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    const token = randomToken();
    db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, u.id);
    setCookie(res, token, SESSION_DAYS * 86400);
    res.json({ ok: true, mustChangePassword: !!u.must_change_password });
  });

  app.post("/api/logout", (req, res) => {
    const token = readCookie(req);
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    setCookie(res, "", 0);
    res.json({ ok: true });
  });

  app.get("/api/me", auth, (req, res) => {
    const { id, email, name, role, must_change_password } = req.user;
    res.json({ id, email, name, role, mustChangePassword: !!must_change_password, tarifa: config.tarifa, municipios: MUNICIPIOS.map(({ key, name }) => ({ key, name })), estadosDropi: ESTADOS_DROPI });
  });

  app.post("/api/password", auth, (req, res) => {
    const { actual, nueva } = req.body || {};
    const u = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!verifyPassword(String(actual || ""), u.password_hash)) return res.status(400).json({ error: "La contraseña actual no es correcta." });
    if (String(nueva || "").length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hashPassword(nueva), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Conexión a Dropi ----------
  const connView = (c) => c ? { status: c.status, email: c.email, lastError: c.last_error, connectedAt: c.connected_at } : { status: "disconnected" };
  const getConn = (uid) => db.prepare("SELECT * FROM dropi_connections WHERE user_id = ?").get(uid);
  const dropiErr = (res, e) => res.status(e.code === "network" ? 502 : 400).json({ error: e.message, code: e.code });

  app.get("/api/dropi", auth, (req, res) => res.json(connView(getConn(req.user.id))));

  app.post("/api/dropi/login", auth, async (req, res) => {
    const email = String(req.body?.email || "").trim(), password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Escribe el correo y la contraseña de tu cuenta de Dropi." });
    try {
      const r = await dropi.login({ email, password });
      const status = r.status === "connected" ? "connected" : "needs_code";
      db.prepare(`INSERT INTO dropi_connections (user_id, email, password_enc, token_enc, challenge_enc, status, last_error, connected_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, password_enc=excluded.password_enc, token_enc=excluded.token_enc,
          challenge_enc=excluded.challenge_enc, status=excluded.status, last_error=NULL, connected_at=excluded.connected_at, updated_at=datetime('now')`)
        .run(req.user.id, email, cipher.encrypt(password), r.token ? cipher.encrypt(r.token) : null,
          r.challenge ? cipher.encrypt(JSON.stringify(r.challenge)) : null, status, status === "connected" ? new Date().toISOString() : null);
      res.json(connView(getConn(req.user.id)));
    } catch (e) { dropiErr(res, e); }
  });

  app.post("/api/dropi/verify", auth, async (req, res) => {
    const c = getConn(req.user.id);
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (!c || !c.challenge_enc) return res.status(400).json({ error: "Primero escribe tu usuario y contraseña de Dropi." });
    if (code.length < 4) return res.status(400).json({ error: "Escribe el código que te llegó de Dropi." });
    try {
      const r = await dropi.verify({ challenge: JSON.parse(cipher.decrypt(c.challenge_enc)), code });
      db.prepare("UPDATE dropi_connections SET token_enc = ?, challenge_enc = NULL, status = 'connected', last_error = NULL, connected_at = ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(cipher.encrypt(r.token), new Date().toISOString(), req.user.id);
      res.json(connView(getConn(req.user.id)));
    } catch (e) { dropiErr(res, e); }
  });

  // Si la sesión de Dropi venció: vuelve a entrar con la contraseña guardada y pide código nuevo
  app.post("/api/dropi/reconnect", auth, async (req, res) => {
    const c = getConn(req.user.id);
    if (!c) return res.status(400).json({ error: "Dropi no está conectado." });
    try {
      const r = await dropi.login({ email: c.email, password: cipher.decrypt(c.password_enc) });
      db.prepare("UPDATE dropi_connections SET token_enc = COALESCE(?, token_enc), challenge_enc = ?, status = ?, last_error = NULL, updated_at = datetime('now') WHERE user_id = ?")
        .run(r.token ? cipher.encrypt(r.token) : null, r.challenge ? cipher.encrypt(JSON.stringify(r.challenge)) : null, r.status, req.user.id);
      res.json(connView(getConn(req.user.id)));
    } catch (e) { dropiErr(res, e); }
  });

  app.delete("/api/dropi", auth, (req, res) => {
    db.prepare("DELETE FROM dropi_connections WHERE user_id = ?").run(req.user.id);
    res.json({ status: "disconnected" });
  });

  // ---------- Reglas ----------
  app.get("/api/rules", auth, (req, res) => res.json(getRules(db, req.user.id)));
  app.put("/api/rules", auth, (req, res) => {
    const b = req.body || {}, valid = MUNICIPIOS.map((m) => m.key);
    const rules = {
      municipios: [...new Set((b.municipios || []).filter((k) => valid.includes(k)))],
      estados: [...new Set((b.estados || []).filter((k) => ESTADOS_DROPI.includes(k)))],
      cancelar: !!b.cancelar,
      cada_minutos: [5, 15, 30, 60].includes(Number(b.cada_minutos)) ? Number(b.cada_minutos) : 15,
    };
    saveRules(db, req.user.id, rules);
    res.json(rules);
  });

  // ---------- Sincronización ----------
  app.post("/api/sync", auth, async (req, res) => {
    const r = await syncUser({ db, dropi, cipher, userId: req.user.id, tarifa: config.tarifa });
    if (r.skipped) return res.status(400).json({ error: "Conecta tu cuenta de Dropi primero." });
    res.json(r);
  });
  app.get("/api/sync/last", auth, (req, res) => {
    const r = db.prepare("SELECT * FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.user.id);
    res.json(r ? { ...r, events: JSON.parse(r.events || "[]") } : null);
  });

  // ---------- Pedidos ----------
  app.get("/api/orders", auth, (req, res) => {
    res.json(db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 500").all(req.user.id));
  });

  app.post("/api/orders", auth, (req, res) => {
    const b = req.body || {};
    const cov = checkCoverage({ ciudad: b.municipio, estado: "Nuevo León", cp: b.cp });
    if (!cov.ok) return res.status(400).json({ error: cov.reason });
    if (!String(b.cliente || "").trim() || !String(b.direccion || "").trim()) return res.status(400).json({ error: "Falta el nombre o la dirección del cliente." });
    const row = db.prepare(`INSERT INTO orders (user_id, origen, dropi_id, cliente, telefono, direccion, municipio, cp, producto, cod, tarifa)
      VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .get(req.user.id, b.dropiId ? String(b.dropiId) : null, String(b.cliente).trim(), String(b.telefono || ""), String(b.direccion).trim(),
        cov.muni.name, String(b.cp || ""), String(b.producto || ""), Number(b.cod) || 0, config.tarifa);
    res.status(201).json(row);
  });

  app.get("/api/stats", auth, (req, res) => {
    const by = Object.fromEntries(ORDER_STATUS.map((s) => [s, 0]));
    for (const r of db.prepare("SELECT status, COUNT(*) n FROM orders WHERE user_id = ? GROUP BY status").all(req.user.id)) by[r.status] = r.n;
    const cod = db.prepare("SELECT COALESCE(SUM(cod),0) c FROM orders WHERE user_id = ? AND status = 'entregado'").get(req.user.id).c;
    const muni = db.prepare("SELECT municipio, COUNT(*) n FROM orders WHERE user_id = ? AND status != 'cancelado' GROUP BY municipio ORDER BY n DESC").all(req.user.id);
    const cancelErrors = db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id = ? AND dropi_cancel = 'error'").get(req.user.id).n;
    res.json({ byStatus: by, codEntregado: cod, porMunicipio: muni, cancelErrors });
  });

  app.get("/api/coverage", (req, res) => res.json(checkCoverage({ ciudad: req.query.ciudad, estado: req.query.estado, cp: req.query.cp })));

  app.use("/api", (req, res) => res.status(404).json({ error: "No encontrado" }));
  app.use((err, req, res, _next) => { console.error(err); res.status(500).json({ error: "Algo falló de nuestro lado. Intenta de nuevo." }); });
  return app;
}
