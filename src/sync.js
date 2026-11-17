import { checkCoverage } from "./coverage.js";
import { getRules } from "./db.js";

/**
 * Revisa el Dropi de un dropshipper: toma los pedidos que cumplen sus reglas y están en cobertura,
 * los guarda en Avirofy y (si así lo pidió) los cancela en su Dropi.
 * El pedido se guarda ANTES de cancelar, para que nunca se pierda: si la cancelación falla,
 * queda marcado con dropi_cancel = 'error' y se muestra en el panel.
 */
export async function syncUser({ db, dropi, cipher, userId, tarifa }) {
  const conn = db.prepare("SELECT * FROM dropi_connections WHERE user_id = ?").get(userId);
  if (!conn || conn.status !== "connected") return { skipped: true, reason: "Dropi no está conectado" };
  const rules = getRules(db, userId);
  const run = db.prepare("INSERT INTO sync_runs (user_id) VALUES (?) RETURNING id").get(userId);
  const events = [];
  const finish = (error) => {
    const tomados = events.filter((e) => e.taken).length;
    db.prepare("UPDATE sync_runs SET finished_at = datetime('now'), revisados = ?, tomados = ?, error = ?, events = ? WHERE id = ?")
      .run(events.length, tomados, error ?? null, JSON.stringify(events), run.id);
    return { runId: run.id, revisados: events.length, tomados, error: error ?? null, events };
  };

  let token;
  try { token = cipher.decrypt(conn.token_enc); } catch { return finish("No se pudo leer la sesión de Dropi; vuelve a conectar"); }

  let list;
  try {
    list = await dropi.listOrders({ token, estados: rules.estados });
  } catch (e) {
    if (e.code === "expired" || e.code === "auth") {
      db.prepare("UPDATE dropi_connections SET status = 'expired', last_error = ?, updated_at = datetime('now') WHERE user_id = ?").run(e.message, userId);
    }
    return finish(e.message);
  }

  const exists = db.prepare("SELECT 1 FROM orders WHERE user_id = ? AND dropi_id = ?");
  const insert = db.prepare(`INSERT INTO orders (user_id, origen, dropi_id, cliente, telefono, direccion, municipio, estado, cp, producto, cod, tarifa, dropi_cancel)
    VALUES (?, 'dropi', ?, ?, ?, ?, ?, 'Nuevo León', ?, ?, ?, ?, ?) RETURNING id`);
  const setCancel = db.prepare("UPDATE orders SET dropi_cancel = ?, dropi_cancel_error = ? WHERE id = ?");

  for (const o of list) {
    const base = { dropiId: o.dropiId, cliente: o.cliente, producto: o.producto, ciudad: o.ciudad, estado: o.estado, cp: o.cp, cod: o.cod, estadoDropi: o.estadoDropi, taken: false };
    if (exists.get(userId, o.dropiId)) continue; // ya lo teníamos; no se reporta otra vez
    if (!rules.estados.includes(o.estadoDropi)) { events.push({ ...base, why: `El estado ${o.estadoDropi} no está en tus reglas` }); continue; }
    const cov = checkCoverage(o);
    if (!cov.ok) { events.push({ ...base, why: cov.reason }); continue; }
    if (!rules.municipios.includes(cov.muni.key)) { events.push({ ...base, why: `${cov.muni.name} está desactivado en tus reglas` }); continue; }

    const row = insert.get(userId, o.dropiId, o.cliente, o.telefono, o.direccion, cov.muni.name, o.cp, o.producto, o.cod, tarifa, rules.cancelar ? "pendiente" : "no_aplica");
    const ev = { ...base, taken: true, municipio: cov.muni.name, orderId: row.id };
    if (rules.cancelar) {
      try {
        await dropi.cancelOrder({ token, dropiId: o.dropiId });
        setCancel.run("cancelado", null, row.id);
        Object.assign(ev, { cancel: "cancelado", why: `Pasa a bodega ${cov.muni.name}. Cancelado en tu Dropi.` });
      } catch (e) {
        setCancel.run("error", e.message, row.id);
        Object.assign(ev, { cancel: "error", why: `Pasa a bodega ${cov.muni.name}, pero no se pudo cancelar en Dropi: ${e.message}. Cancélalo tú.` });
      }
    } else {
      Object.assign(ev, { cancel: "no_aplica", why: `Pasa a bodega ${cov.muni.name}. Sigue activo en tu Dropi; cancélalo tú.` });
    }
    events.push(ev);
  }
  return finish(null);
}

/** Revisa a todos los dropshippers conectados cuya frecuencia ya se cumplió. */
export async function syncDue({ db, dropi, cipher, tarifa, now = new Date() }) {
  const users = db.prepare(`SELECT c.user_id, COALESCE(r.cada_minutos, 15) AS cada,
      (SELECT MAX(started_at) FROM sync_runs s WHERE s.user_id = c.user_id) AS last
    FROM dropi_connections c LEFT JOIN rules r ON r.user_id = c.user_id WHERE c.status = 'connected'`).all();
  const results = [];
  for (const u of users) {
    const last = u.last ? new Date(u.last.replace(" ", "T") + "Z") : null;
    if (last && now - last < u.cada * 60_000) continue;
    results.push({ userId: u.user_id, ...(await syncUser({ db, dropi, cipher, userId: u.user_id, tarifa })) });
  }
  return results;
}
