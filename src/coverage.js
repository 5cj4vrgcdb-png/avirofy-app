// Cobertura de entrega de Avirofy: 10 municipios del área metropolitana de Monterrey, Nuevo León.
export const MUNICIPIOS = [
  { key: "monterrey", name: "Monterrey", aliases: ["monterrey", "mty"] },
  { key: "guadalupe", name: "Guadalupe", aliases: ["guadalupe", "cd guadalupe", "ciudad guadalupe"] },
  { key: "juarez", name: "Juárez", aliases: ["juarez", "benito juarez", "cd benito juarez", "ciudad benito juarez", "cd juarez", "ciudad juarez"] },
  { key: "cadereyta", name: "Cadereyta Jiménez", aliases: ["cadereyta", "cadereyta jimenez"] },
  { key: "apodaca", name: "Apodaca", aliases: ["apodaca", "cd apodaca", "ciudad apodaca"] },
  { key: "sannicolas", name: "San Nicolás de los Garza", aliases: ["san nicolas", "san nicolas de los garza", "sn nicolas"] },
  { key: "escobedo", name: "General Escobedo", aliases: ["escobedo", "general escobedo", "gral escobedo", "cd escobedo", "cd general escobedo"] },
  { key: "garcia", name: "García", aliases: ["garcia", "cd garcia", "ciudad garcia"] },
  { key: "santacatarina", name: "Santa Catarina", aliases: ["santa catarina", "cd santa catarina", "sta catarina"] },
  { key: "sanpedro", name: "San Pedro Garza García", aliases: ["san pedro", "san pedro garza garcia", "spgg"] },
];

const NL = ["nuevo leon", "nl", "n l"];
const ALIASES = MUNICIPIOS.flatMap((m) => m.aliases.map((a) => ({ m, a }))).sort((x, y) => y.a.length - x.a.length);

export const norm = (s) =>
  (s ?? "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Revisa si un destino está dentro de la cobertura.
 * @param {{ciudad?:string, estado?:string, cp?:string}} destino
 * @returns {{ok:true, muni:object} | {ok:false, reason:string}}
 */
export function checkCoverage({ ciudad, estado, cp } = {}) {
  const c = norm(ciudad), e = norm(estado), z = (cp ?? "").toString().replace(/\D/g, "");
  if (e && !NL.includes(e)) return { ok: false, reason: `Estado fuera de zona (${estado}). Solo entregamos en Nuevo León.` };
  if (z && !/^6[4-7]\d{3}$/.test(z)) return { ok: false, reason: `El código postal ${z} no pertenece a Nuevo León.` };
  if (!c) return { ok: false, reason: "Falta el municipio de entrega." };
  // "Ciudad Juárez" sin estado ni CP es ambiguo con Chihuahua: exigimos CP de NL
  if (/^(cd|ciudad) juarez$/.test(c) && !z && !e) return { ok: false, reason: "Ciudad Juárez es ambiguo; falta el estado o el código postal." };
  const hit = ALIASES.find(({ a }) => c === a || c.startsWith(a + " ") || c.endsWith(" " + a));
  if (!hit) return { ok: false, reason: `${ciudad} no está en la cobertura de Avirofy.` };
  return { ok: true, muni: hit.m };
}
