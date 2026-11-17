// Avirofy: panel del dropshipper. Habla con la API en /api.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
  const fmtDate = (d) => new Date(String(d).replace(" ", "T") + (String(d).includes("Z") || String(d).includes("+") ? "" : "Z")).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const STATUS = {
    recibido: { label: "Recibido", cls: "st-recibido" },
    bodega: { label: "En bodega", cls: "st-bodega" },
    ruta: { label: "En ruta", cls: "st-ruta" },
    entregado: { label: "Entregado", cls: "st-entregado" },
    novedad: { label: "Novedad", cls: "st-novedad" },
    cancelado: { label: "Cancelado", cls: "st-rechazado" },
  };
  const ESTADO_DESC = {
    "PENDIENTE CONFIRMACION": "El cliente aún no confirma",
    PENDIENTE: "Confirmado, sin guía",
    GUIA_GENERADA: "Ya tiene guía de paquetería; habría que anularla",
  };
  const pill = (st) => `<span class="pill ${STATUS[st]?.cls || ""}">${STATUS[st]?.label || esc(st)}</span>`;
  const cancelTag = (o) => o.dropi_cancel === "error" ? `<span class="reason" style="display:block">No se pudo cancelar en Dropi: ${esc(o.dropi_cancel_error)}</span>`
    : o.dropi_cancel === "cancelado" ? `<span class="s">Cancelado en Dropi</span>` : "";

  let me = null, dropi = { status: "disconnected" }, orders = [], filter = "todos", q = "", lastSync = null;

  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3000); }

  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/login") { me = null; showLogin(); }
    if (!r.ok) { const e = new Error(data.error || "Algo falló. Intenta de nuevo."); e.status = r.status; throw e; }
    return data;
  }

  // ---------- Vistas ----------
  const VIEWS = {
    panel: { title: "Panel", sub: "Resumen de tus envíos locales en Monterrey y área metropolitana", render: renderPanel },
    nuevo: { title: "Nuevo pedido", sub: "Captura un pedido a mano y valida la cobertura", render: renderNuevo, bind: bindNuevo },
    sync: { title: "Sincronizar Dropi", sub: "Avirofy toma de tu Dropi solo los pedidos en cobertura y los cancela allá", render: renderSync, bind: bindSync },
    pedidos: { title: "Mis pedidos", sub: "Seguimiento de cada pedido de bodega a entrega", render: renderPedidos, bind: bindPedidos },
    cobertura: { title: "Cobertura", sub: "Municipios de Nuevo León donde entregamos", render: renderCobertura, bind: bindCobertura },
    integraciones: { title: "Integraciones", sub: "Conecta tu cuenta de Dropi", render: renderIntegraciones, bind: bindIntegraciones },
  };

  async function renderPanel() {
    const s = await api("GET", "/api/stats");
    const by = s.byStatus;
    const activos = by.recibido + by.bodega + by.ruta + by.novedad;
    const cerrados = by.entregado + by.novedad;
    const efect = cerrados ? Math.round((by.entregado / cerrados) * 100) : 0;
    const max = Math.max(1, ...s.porMunicipio.map((r) => r.n));
    const recent = orders.slice(0, 6);
    return `
    ${dropi.status !== "connected" ? connectBanner() : ""}
    ${s.cancelErrors ? `<div class="check bad"><div class="ico">!</div><div style="flex:1"><h3>${s.cancelErrors} pedido${s.cancelErrors === 1 ? "" : "s"} sin cancelar en Dropi</h3><p>Avirofy ya los tiene, pero siguen activos en tu Dropi. Cancélalos allá para que no salgan dos veces.</p></div><a class="btn" href="#pedidos">Ver pedidos</a></div>` : ""}
    <div class="kpis">
      <div class="card kpi"><span class="lbl">Pedidos activos</span><span class="val num">${activos}</span><span class="delta">${by.recibido} por recibir en bodega</span></div>
      <div class="card kpi"><span class="lbl">Entregados</span><span class="val num">${by.entregado}</span><span class="delta">Efectividad <b>${efect}%</b></span></div>
      <div class="card kpi"><span class="lbl">COD cobrado</span><span class="val num">${money(s.codEntregado)}</span><span class="delta">Menos ${money(me.tarifa)} por entrega</span></div>
      <div class="card kpi"><span class="lbl">Novedades</span><span class="val num">${by.novedad}</span><span class="delta">Requieren tu atención</span></div>
    </div>
    <section class="card">
      <div class="card-h"><h2>Flujo</h2><div class="spacer"></div><span class="sub mono" style="color:var(--muted)">Tu Dropi → Avirofy → Bodega → Ruta → Entrega</span></div>
      <div class="flow">${["recibido", "bodega", "ruta", "entregado", "novedad"].map((k, i) => `<a class="flow-step" href="#pedidos" data-filter="${k}" style="text-decoration:none;color:inherit"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="lbl">${STATUS[k].label}</span><span class="v num">${by[k]}</span></a>`).join("")}</div>
    </section>
    <div class="grid2">
      <section class="card">
        <div class="card-h"><h2>Pedidos recientes</h2><div class="spacer"></div><a class="btn" href="#pedidos">Ver todos</a></div>
        ${recent.length ? `<div class="tbl-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Municipio</th><th>Estado</th></tr></thead><tbody>
        ${recent.map((o) => `<tr><td><span class="mono">${esc(o.dropi_id ? "DRP-" + o.dropi_id : "AVF-" + o.id)}</span><span class="s">${fmtDate(o.created_at)}</span></td><td>${esc(o.cliente)}<span class="s">${esc(o.producto)}</span></td><td>${esc(o.municipio)}</td><td>${pill(o.status)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Aún no tienes pedidos. Conecta tu Dropi y sincroniza, o captura uno a mano.</div>`}
      </section>
      <section class="card">
        <div class="card-h"><h2>Pedidos por municipio</h2></div>
        <div class="card-b bars">${s.porMunicipio.map((r) => `<div class="bar-row"><span title="${esc(r.municipio)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.municipio.replace(" de los Garza", "").replace(" Garza García", "").replace(" Jiménez", "").replace("General ", ""))}</span><div class="bar-track"><div class="bar-fill" style="width:${(r.n / max) * 100}%"></div></div><span class="n num">${r.n}</span></div>`).join("") || `<div class="empty">Sin pedidos aún</div>`}</div>
      </section>
    </div>`;
  }

  const connectBanner = () => {
    const exp = dropi.status === "expired" || dropi.status === "needs_code";
    return `<div class="check bad"><div class="ico">!</div><div style="flex:1"><h3>${exp ? "Tu sesión de Dropi necesita verificación" : "Conecta tu cuenta de Dropi"}</h3><p>${exp ? "Mientras no la verifiques, Avirofy no puede tomar tus pedidos." : "Sin la conexión Avirofy no puede leer tus pedidos."}</p></div><a class="btn primary" href="#integraciones">${exp ? "Verificar" : "Conectar Dropi"}</a></div>`;
  };

  function renderNuevo() {
    return `
    <div class="grid2">
      <section class="card">
        <div class="card-h"><h2>Datos del pedido</h2></div>
        <form class="card-b form" id="fNuevo" novalidate>
          <div class="field"><label for="f-dropi">Número de pedido Dropi (opcional)</label><input id="f-dropi" inputmode="numeric"></div>
          <div class="field"><label for="f-tel">Teléfono del cliente</label><input id="f-tel" inputmode="tel" placeholder="10 dígitos"></div>
          <div class="field full"><label for="f-cliente">Nombre del cliente</label><input id="f-cliente" required></div>
          <div class="field full"><label for="f-dir">Calle, número y colonia</label><input id="f-dir" required></div>
          <div class="field"><label for="f-ciudad">Municipio</label><select id="f-ciudad">${me.municipios.map((m) => `<option>${esc(m.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="f-cp">Código postal</label><input id="f-cp" inputmode="numeric" maxlength="5"></div>
          <div class="field full"><label for="f-prod">Producto</label><input id="f-prod"></div>
          <div class="field"><label for="f-cod">Monto a cobrar (COD)</label><input id="f-cod" inputmode="decimal"></div>
          <div class="field"><label for="f-notas">Referencias</label><input id="f-notas" placeholder="Casa blanca, portón negro"></div>
          <div class="form-actions"><a class="btn" href="#pedidos">Cancelar</a><button class="btn primary" id="bEnviar" type="submit">Enviar a Avirofy</button></div>
        </form>
      </section>
      <aside style="display:flex;flex-direction:column;gap:16px">
        <div class="check idle" id="covBox"></div>
        <section class="card"><div class="card-h"><h2>Resumen</h2></div><div class="card-b"><ul class="summary-list" id="sumList"></ul></div></section>
      </aside>
    </div>`;
  }
  function bindNuevo() {
    let t;
    async function update() {
      const cod = parseFloat($("f-cod").value) || 0;
      $("sumList").innerHTML = `<li><span>Monto COD</span><span class="num">${money(cod)}</span></li><li><span>Tarifa Avirofy</span><span class="num">−${money(me.tarifa)}</span></li><li class="total"><span>Te depositamos</span><span class="num">${money(Math.max(0, cod - me.tarifa))}</span></li>`;
      clearTimeout(t);
      t = setTimeout(async () => {
        const r = await api("GET", `/api/coverage?${new URLSearchParams({ ciudad: $("f-ciudad").value, estado: "Nuevo León", cp: $("f-cp").value })}`);
        const box = $("covBox"); if (!box) return;
        box.className = "check " + (r.ok ? "ok" : "bad");
        box.innerHTML = r.ok ? `<div class="ico">✓</div><div><h3>Dentro de cobertura</h3><p>${esc(r.muni.name)}, Nuevo León.</p></div>` : `<div class="ico">✕</div><div><h3>Fuera de cobertura</h3><p>${esc(r.reason)}</p></div>`;
        $("bEnviar").disabled = !r.ok;
      }, 200);
    }
    $("fNuevo").addEventListener("input", update);
    $("fNuevo").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("POST", "/api/orders", { dropiId: $("f-dropi").value.trim(), cliente: $("f-cliente").value, telefono: $("f-tel").value, direccion: [$("f-dir").value, $("f-notas").value].filter(Boolean).join(". "), municipio: $("f-ciudad").value, cp: $("f-cp").value, producto: $("f-prod").value, cod: $("f-cod").value });
        toast("Pedido enviado a Avirofy"); location.hash = "#pedidos";
      } catch (err) { toast(err.message); }
    });
    update();
  }

  async function renderSync() {
    const [rules, last] = await Promise.all([api("GET", "/api/rules"), api("GET", "/api/sync/last")]);
    lastSync = last;
    const con = dropi.status === "connected";
    return `
    ${con ? "" : connectBanner()}
    <div class="grid2">
      <section class="card">
        <div class="card-h"><h2>Reglas de extracción</h2><div class="spacer"></div><span class="sub" id="rSaved" style="color:var(--muted)">Se guardan solas</span></div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:18px">
          <div class="field"><label>Municipios que Avirofy toma de tu Dropi</label>
            <span class="hint">Solo puedes elegir dentro de la cobertura de Avirofy. Los demás pedidos se quedan en Dropi sin cambios.</span>
            <div class="opts">${me.municipios.map((m) => `<label class="opt"><input type="checkbox" data-muni="${m.key}" ${rules.municipios.includes(m.key) ? "checked" : ""}> ${esc(m.name)}</label>`).join("")}</div>
          </div>
          <div class="field"><label>Estados de Dropi que se toman</label>
            <div class="opts one">${me.estadosDropi.map((k) => `<label class="opt"><input type="checkbox" data-est="${k}" ${rules.estados.includes(k) ? "checked" : ""}> <span><span class="mono">${k}</span><span class="s">${ESTADO_DESC[k] || ""}</span></span></label>`).join("")}</div>
          </div>
          <label class="opt toggle"><input type="checkbox" id="r-cancel" ${rules.cancelar ? "checked" : ""}> <span><b>Cancelar en Dropi automáticamente</b><span class="s">Al tomar un pedido, Avirofy lo cambia a CANCELADO en tu Dropi para que no salga dos veces.</span></span></label>
          <div class="field" style="max-width:240px"><label for="r-cada">Revisar mi Dropi cada</label>
            <select id="r-cada">${[5, 15, 30, 60].map((v) => `<option value="${v}" ${rules.cada_minutos === v ? "selected" : ""}>${v} minutos</option>`).join("")}</select></div>
        </div>
      </section>
      <aside style="display:flex;flex-direction:column;gap:16px">
        <section class="card"><div class="card-h"><h2>Sincronización</h2></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:12px">
            <ul class="summary-list">
              <li><span>Cuenta Dropi</span><span>${con ? esc(dropi.email) : "Sin conectar"}</span></li>
              <li><span>Frecuencia</span><span>Cada ${rules.cada_minutos} min</span></li>
              <li><span>Última revisión</span><span>${last ? fmtDate(last.started_at) : "Aún no"}</span></li>
            </ul>
            <button class="btn primary" id="bSync" type="button" style="justify-content:center" ${con ? "" : "disabled"}>Sincronizar ahora</button>
          </div></section>
        <section class="card"><div class="card-h"><h2>Cómo funciona</h2></div>
          <div class="card-b"><ol class="steps">
            <li>Avirofy revisa tus pedidos nuevos en Dropi.</li>
            <li>Toma solo los que cumplen tus reglas y están en cobertura.</li>
            <li>Los cancela en tu Dropi y los pasa a bodega Avirofy.</li>
            <li>Los que no cumplen se quedan en Dropi y salen con tu paquetería normal.</li>
          </ol></div></section>
      </aside>
    </div>
    <section class="card" id="logCard" hidden>
      <div class="card-h"><h2>Resultado de la última revisión</h2><span class="sub" id="logSum" style="color:var(--muted)"></span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Pedido Dropi</th><th>Cliente</th><th>Destino</th><th>Estado en Dropi</th><th class="num">COD</th><th>Qué hizo Avirofy</th></tr></thead><tbody id="logBody"></tbody></table></div>
    </section>`;
  }
  function fillLog(run) {
    if (!run) return;
    const ev = run.events || [];
    $("logCard").hidden = false;
    $("logSum").textContent = run.error ? `Error: ${run.error}` : `${run.tomados} tomados · ${ev.length - run.tomados} se quedan en Dropi`;
    $("logBody").innerHTML = ev.length ? ev.map((r) => `<tr><td class="mono">${esc(r.dropiId)}</td><td>${esc(r.cliente)}<span class="s">${esc(r.producto)}</span></td><td>${esc(r.ciudad)}<span class="s">${esc(r.estado)} ${esc(r.cp)}</span></td><td><span class="mono">${esc(r.estadoDropi)}</span>${r.cancel === "cancelado" ? `<span class="s mono">→ CANCELADO</span>` : ""}</td><td class="num">${money(r.cod)}</td><td>${r.taken ? `<span class="pill ${r.cancel === "error" ? "st-novedad" : "st-entregado"}">Tomado</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">Se queda en Dropi</span>`}<span class="s" style="margin-top:3px">${esc(r.why)}</span></td></tr>`).join("")
      : `<tr><td colspan="6"><div class="empty">No había pedidos nuevos.</div></td></tr>`;
  }
  function bindSync() {
    let t;
    const saveRules = () => { clearTimeout(t); t = setTimeout(async () => {
      try {
        await api("PUT", "/api/rules", {
          municipios: [...document.querySelectorAll("[data-muni]:checked")].map((x) => x.dataset.muni),
          estados: [...document.querySelectorAll("[data-est]:checked")].map((x) => x.dataset.est),
          cancelar: $("r-cancel").checked, cada_minutos: Number($("r-cada").value),
        });
        $("rSaved").textContent = "Guardado";
      } catch (e) { toast(e.message); }
    }, 300); };
    document.querySelectorAll("[data-muni],[data-est],#r-cancel,#r-cada").forEach((c) => (c.onchange = saveRules));
    $("bSync").onclick = async () => {
      $("bSync").disabled = true; $("bSync").textContent = "Revisando tu Dropi…";
      try {
        const r = await api("POST", "/api/sync");
        orders = await api("GET", "/api/orders");
        toast(r.error ? r.error : r.tomados ? `${r.tomados} pedidos tomados de tu Dropi` : "No hay pedidos nuevos en tu zona");
        await loadDropi(); render(); setTimeout(() => fillLog({ ...r, started_at: new Date().toISOString() }), 50);
      } catch (e) { toast(e.message); $("bSync").disabled = false; $("bSync").textContent = "Sincronizar ahora"; }
    };
    fillLog(lastSync);
  }

  function renderPedidos() {
    const keys = ["todos", "recibido", "bodega", "ruta", "entregado", "novedad", "cancelado"];
    return `
    <section class="card">
      <div class="card-h toolbar">
        ${keys.map((k) => `<button class="chip ${filter === k ? "on" : ""}" data-f="${k}" type="button">${k === "todos" ? "Todos" : STATUS[k].label} <span class="num">${k === "todos" ? orders.length : orders.filter((o) => o.status === k).length}</span></button>`).join("")}
        <div class="spacer"></div>
        <input class="search" id="f-q" placeholder="Buscar pedido, cliente o municipio" value="${esc(q)}">
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Dirección</th><th>Producto</th><th class="num">COD</th><th>Estado</th><th>Fecha</th></tr></thead><tbody id="pBody"></tbody></table></div>
    </section>`;
  }
  const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function fillPedidos() {
    const nq = norm(q);
    const rows = orders.filter((o) => (filter === "todos" || o.status === filter) && (!nq || norm([o.dropi_id, o.id, o.cliente, o.municipio, o.producto].join(" ")).includes(nq)));
    $("pBody").innerHTML = rows.length ? rows.map((o) => `<tr><td><span class="mono">${esc(o.dropi_id ? "DRP-" + o.dropi_id : "AVF-" + o.id)}</span><span class="s">${o.origen === "dropi" ? "Dropi" : "Manual"}</span></td><td>${esc(o.cliente)}<span class="s mono">${esc(o.telefono)}</span></td><td style="min-width:200px">${esc(o.direccion)}<span class="s">${esc(o.municipio)}, ${esc(o.estado)} ${esc(o.cp)}</span>${cancelTag(o)}</td><td>${esc(o.producto)}</td><td class="num">${money(o.cod)}</td><td>${pill(o.status)}</td><td class="num" style="white-space:nowrap">${fmtDate(o.created_at)}</td></tr>`).join("")
      : `<tr><td colspan="7"><div class="empty">${orders.length ? "No hay pedidos con ese filtro." : "Aún no tienes pedidos."}</div></td></tr>`;
  }
  function bindPedidos() {
    document.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; render(); }));
    const s = $("f-q"); s.oninput = () => { q = s.value; fillPedidos(); };
    fillPedidos();
  }

  function renderCobertura() {
    const c = {}; orders.forEach((o) => (c[o.municipio] = (c[o.municipio] || 0) + 1));
    return `
    <section class="card"><div class="card-h"><h2>Probar una dirección</h2></div>
      <div class="card-b form">
        <div class="field"><label for="t-ciudad">Municipio o ciudad</label><input id="t-ciudad" value="Santa Catarina"></div>
        <div class="field"><label for="t-cp">Código postal (opcional)</label><input id="t-cp" inputmode="numeric" maxlength="5"></div>
        <div class="field full"><div class="check idle" id="tBox"></div></div>
      </div></section>
    <div class="muni-grid">${me.municipios.map((m) => `<div class="card muni"><h3>${esc(m.name)}</h3><span class="s">Nuevo León</span><span class="pill st-entregado tag">${c[m.name] || 0} pedidos</span></div>`).join("")}</div>
    <p class="note"><b>Regla:</b> si el estado no es Nuevo León, el código postal no empieza con 64 a 67, o el municipio no es uno de estos 10, el pedido se queda en tu Dropi.</p>`;
  }
  function bindCobertura() {
    let t;
    const u = () => { clearTimeout(t); t = setTimeout(async () => {
      const r = await api("GET", `/api/coverage?${new URLSearchParams({ ciudad: $("t-ciudad").value, cp: $("t-cp").value })}`);
      const b = $("tBox"); if (!b) return;
      b.className = "check " + (r.ok ? "ok" : "bad");
      b.innerHTML = r.ok ? `<div class="ico">✓</div><div><h3>Sí entregamos</h3><p>${esc(r.muni.name)}, Nuevo León.</p></div>` : `<div class="ico">✕</div><div><h3>No entregamos ahí</h3><p>${esc(r.reason)}</p></div>`;
    }, 200); };
    $("t-ciudad").oninput = u; $("t-cp").oninput = u; u();
  }

  let editing = false;
  function renderIntegraciones() {
    const st = dropi.status, on = st === "connected", needCode = st === "needs_code";
    const badge = on ? `<span class="pill st-entregado">Conectado</span>` : st === "expired" ? `<span class="pill st-novedad">Sesión vencida</span>` : needCode ? `<span class="pill st-novedad">Falta el código</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">Sin conectar</span>`;
    const soon = (name, color, ini, desc) => `<section class="card int"><div class="card-h"><div class="int-logo" style="background:${color}">${ini}</div><div><h2>${name}</h2><span class="s" style="font-size:12px;color:var(--muted)">Opcional</span></div><div class="spacer"></div><span class="pill" style="background:var(--surface-2);color:var(--muted)">Próximamente</span></div><div class="card-b"><p>${desc}</p></div></section>`;
    let body;
    if (needCode) body = `
      <div class="check idle" style="padding:12px 14px"><div class="ico" style="width:28px;height:28px">2</div><div><h3 style="font-size:14px">Verifica tu cuenta</h3><p>Dropi envió un código de verificación para ${esc(dropi.email)}. Escríbelo para terminar de conectar.</p></div></div>
      <form id="fCode" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <div class="field"><label for="i-code">Código de verificación</label><input id="i-code" inputmode="numeric" maxlength="8" autocomplete="one-time-code" class="mono" style="letter-spacing:.3em;font-size:16px"></div>
        <div class="foot"><button class="btn primary" type="submit">Verificar y conectar</button><button class="btn" type="button" data-cancel>Cancelar</button></div>
      </form>`;
    else if (on && !editing) body = `
      <p class="mono" style="color:var(--fg)">${esc(dropi.email)}</p>
      <p style="font-size:12.5px">Sesión activa. Si Dropi la cierra, te pediremos un código nuevo.</p>
      <div class="foot"><button class="btn" data-edit type="button">Cambiar cuenta</button><button class="btn" data-off type="button">Desconectar</button></div>`;
    else if (st === "expired" && !editing) body = `
      <p>${esc(dropi.lastError || "Dropi cerró la sesión.")}</p>
      <div class="foot"><button class="btn primary" id="bReconnect" type="button">Pedir código nuevo</button><button class="btn" data-edit type="button">Cambiar cuenta</button></div>`;
    else body = `
      <form id="fDropi" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <div class="field"><label for="i-email">Correo de tu cuenta Dropi</label><input id="i-email" type="email" autocomplete="off" value="${esc(dropi.email || "")}"></div>
        <div class="field"><label for="i-pass">Contraseña de Dropi</label><input id="i-pass" type="password" autocomplete="off"></div>
        <p style="font-size:12px">Usamos tu acceso para leer tus pedidos y cancelar los que tomamos. Tu contraseña se guarda cifrada y nunca se muestra.</p>
        <div class="foot"><button class="btn primary" type="submit">Continuar</button>${editing ? `<button class="btn" type="button" data-cancel>Cancelar</button>` : ""}</div>
      </form>`;
    return `
    <div class="int-grid">
      <section class="card int">
        <div class="card-h"><div class="int-logo" style="background:#E8562A">D</div><div><h2>Dropi</h2><span class="s" style="font-size:12px;color:var(--muted)">Necesaria</span></div><div class="spacer"></div>${badge}</div>
        <div class="card-b"><p>Entra con tu usuario y contraseña de Dropi y el código de verificación. Avirofy lee tus pedidos nuevos, toma los que están en cobertura y los cancela en tu Dropi.</p>${body}</div>
      </section>
      ${soon("Shopify", "#5E8E3E", "S", "Para pedidos de tu tienda que no pasan por Dropi. Avirofy aplicará las mismas reglas de cobertura.")}
      ${soon("ChateaPro", "#2563C9", "C", "Avisará al cliente por WhatsApp cuando su paquete sale a ruta y cuando se entrega.")}
    </div>`;
  }
  function bindIntegraciones() {
    document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { editing = true; render(); }));
    document.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => { editing = false; if (dropi.status === "needs_code") { await api("DELETE", "/api/dropi"); await loadDropi(); } render(); }));
    document.querySelectorAll("[data-off]").forEach((b) => (b.onclick = async () => { await api("DELETE", "/api/dropi"); await loadDropi(); render(); toast("Dropi desconectado"); }));
    $("fDropi")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Conectando…";
      try { dropi = await api("POST", "/api/dropi/login", { email: $("i-email").value, password: $("i-pass").value }); editing = false; render(); if (dropi.status === "connected") toast("Dropi conectado"); else setTimeout(() => $("i-code")?.focus(), 0); }
      catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Continuar"; }
    });
    $("fCode")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { dropi = await api("POST", "/api/dropi/verify", { code: $("i-code").value }); render(); toast("Dropi conectado"); }
      catch (err) { toast(err.message); }
    });
    $("bReconnect")?.addEventListener("click", async () => {
      try { dropi = await api("POST", "/api/dropi/reconnect"); render(); } catch (err) { toast(err.message); }
    });
  }

  // ---------- Navegación ----------
  async function loadDropi() { dropi = await api("GET", "/api/dropi"); }
  let renderSeq = 0;
  async function render() {
    if (!me) return;
    let v = (location.hash || "#panel").slice(1); if (!VIEWS[v]) v = "panel";
    const seq = ++renderSeq;
    $("vTitle").textContent = VIEWS[v].title;
    $("vSub").textContent = VIEWS[v].sub;
    $("topCta").hidden = v === "nuevo";
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === v));
    $("navCount").textContent = orders.filter((o) => !["entregado", "cancelado"].includes(o.status)).length;
    $("navInt").textContent = dropi.status === "connected" ? "1/1" : "0/1";
    $("sideDropi").textContent = dropi.status === "connected" ? "Dropi conectado" : "Dropi sin conectar";
    try {
      if (["panel", "pedidos", "cobertura"].includes(v)) {
        orders = await api("GET", "/api/orders");
        $("navCount").textContent = orders.filter((o) => !["entregado", "cancelado"].includes(o.status)).length;
      }
      const html = await VIEWS[v].render();
      if (seq !== renderSeq) return;
      $("view").innerHTML = html;
      VIEWS[v].bind?.();
      document.querySelectorAll("[data-filter]").forEach((a) => a.addEventListener("click", () => { filter = a.dataset.filter; }));
    } catch (e) { if (e.status !== 401) $("view").innerHTML = `<div class="check bad"><div class="ico">!</div><div><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div></div>`; }
    $("side").classList.remove("open");
  }

  // ---------- Sesión ----------
  function showLogin() { $("login").hidden = false; setTimeout(() => $("l-user").focus(), 0); }
  async function boot() {
    try { me = await api("GET", "/api/me"); } catch { return showLogin(); }
    $("login").hidden = true;
    $("storeName").textContent = me.name; $("sideName").textContent = me.name;
    $("avatar").textContent = me.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    [orders] = await Promise.all([api("GET", "/api/orders"), loadDropi()]);
    if (me.mustChangePassword) openPass(true);
    render();
  }
  $("fLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("lErr");
    try { await api("POST", "/api/login", { email: $("l-user").value, password: $("l-pass").value }); err.hidden = true; $("l-pass").value = ""; boot(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  $("bLogout").onclick = async (e) => { e.preventDefault(); await api("POST", "/api/logout"); me = null; $("view").innerHTML = ""; showLogin(); };

  function openPass(forced) {
    $("passBox").hidden = false; $("pCancel").hidden = forced;
    $("passSub").textContent = forced ? "Estás usando una contraseña temporal. Elige una nueva de al menos 8 caracteres." : "Elige una contraseña nueva de al menos 8 caracteres.";
    setTimeout(() => $("p-actual").focus(), 0);
  }
  $("bPass").onclick = (e) => { e.preventDefault(); openPass(false); };
  $("pCancel").onclick = () => ($("passBox").hidden = true);
  $("fPass").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/password", { actual: $("p-actual").value, nueva: $("p-nueva").value }); $("passBox").hidden = true; $("p-actual").value = $("p-nueva").value = ""; toast("Contraseña actualizada"); }
    catch (x) { $("pErr").textContent = x.message; $("pErr").hidden = false; }
  });

  $("menuBtn").onclick = () => $("side").classList.toggle("open");
  window.addEventListener("hashchange", render);
  boot();
})();
