// Cliente de Dropi por cuenta del dropshipper (usuario, contraseña y código de verificación).
//
// IMPORTANTE: las rutas de Dropi para verificar el código, listar pedidos y cancelar NO están
// confirmadas todavía (no hay documentación oficial pública). Por eso todas son configurables
// en .env y las respuestas se leen de forma tolerante. Ajustar con una cuenta real de prueba.
//
// Interfaz común (live y mock):
//   login({email, password})          -> {status:"connected", token} | {status:"needs_code", challenge}
//   verify({challenge, code})         -> {status:"connected", token}
//   listOrders({token, estados})      -> [{dropiId, estadoDropi, cliente, telefono, direccion, ciudad, estado, cp, producto, cod}]
//   cancelOrder({token, dropiId})     -> {ok:true}
// Errores: lanza DropiError con .code = "auth" | "expired" | "code" | "network" | "api"

export class DropiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((x, p) => x?.[p], o); if (v !== undefined && v !== null && v !== "") return v; } };

export function normalizeOrder(o) {
  const productos = Array.isArray(o.orderdetails) ? o.orderdetails.map((d) => pick(d, "product.name", "name")).filter(Boolean) : [];
  return {
    dropiId: String(pick(o, "id", "order_id")),
    estadoDropi: String(pick(o, "status", "estado") || "").toUpperCase(),
    cliente: [pick(o, "name", "client_name", "nombre"), pick(o, "surname", "apellido")].filter(Boolean).join(" ").trim(),
    telefono: String(pick(o, "phone", "telefono") || ""),
    direccion: String(pick(o, "dir", "address", "direccion") || ""),
    ciudad: String(pick(o, "city", "ciudad", "municipio", "city_name") || ""),
    estado: String(pick(o, "state", "department", "estado", "departamento") || ""),
    cp: String(pick(o, "zip_code", "zip", "cp", "postal_code") || ""),
    producto: productos.join(" + ") || String(pick(o, "product_name", "producto") || ""),
    cod: Number(pick(o, "total_order", "total", "cod") || 0),
  };
}

export function createLiveClient(cfg, fetchImpl = fetch) {
  const url = (p, id) => cfg.base.replace(/\/$/, "") + p.replace(":id", encodeURIComponent(id ?? ""));
  async function call(method, path, { token, body, query, id } = {}) {
    let u = url(path, id);
    if (query) u += "?" + new URLSearchParams(query).toString();
    let res;
    try {
      res = await fetchImpl(u, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new DropiError("network", `No se pudo conectar con Dropi: ${e.message}`); }
    const json = await res.json().catch(() => ({}));
    const msg = String(pick(json, "message", "error") || "");
    if (res.status === 401 || /expired/i.test(msg)) throw new DropiError(token ? "expired" : "auth", token ? "La sesión de Dropi venció" : (msg || "Usuario o contraseña de Dropi incorrectos"));
    if (!res.ok || json.isSuccess === false) throw new DropiError("api", msg || `Dropi respondió ${res.status}`);
    return json;
  }
  const needsCode = (j) => !pick(j, "token", "data.token") && (pick(j, "requires_2fa", "two_factor", "otp_required", "data.requires_2fa") || /verifica|c[oó]digo|otp|2fa/i.test(String(j.message || "")));

  return {
    async login({ email, password }) {
      const j = await call("POST", cfg.paths.login, { body: { email, password, white_brand_id: cfg.whiteBrandId } });
      if (needsCode(j)) return { status: "needs_code", challenge: { email, password, raw: pick(j, "data", "session", "challenge") ?? null } };
      const token = pick(j, "token", "data.token");
      if (!token) throw new DropiError("api", "Dropi no devolvió un token");
      return { status: "connected", token };
    },
    async verify({ challenge, code }) {
      const j = await call("POST", cfg.paths.verify, { body: { email: challenge.email, password: challenge.password, code, otp: code, white_brand_id: cfg.whiteBrandId, ...(challenge.raw && typeof challenge.raw === "object" ? challenge.raw : {}) } })
        .catch((e) => { if (e.code === "auth" || e.code === "api") throw new DropiError("code", "El código no es válido o ya venció"); throw e; });
      const token = pick(j, "token", "data.token");
      if (!token) throw new DropiError("code", "El código no es válido o ya venció");
      return { status: "connected", token };
    },
    async listOrders({ token, estados }) {
      const out = [];
      for (const status of estados) {
        const j = await call("GET", cfg.paths.orders, { token, query: { status, result_number: 100, start: 0 } });
        const list = pick(j, "objects", "data", "orders") || [];
        out.push(...list.map(normalizeOrder));
      }
      return out;
    },
    async cancelOrder({ token, dropiId }) {
      await call("PUT", cfg.paths.cancel, { token, id: dropiId, body: { status: "CANCELADO" } });
      return { ok: true };
    },
  };
}
