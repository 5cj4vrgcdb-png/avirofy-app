import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoverage } from "../src/coverage.js";

const ok = (d, key) => { const r = checkCoverage(d); assert.equal(r.ok, true, JSON.stringify(r)); if (key) assert.equal(r.muni.key, key); };
const no = (d) => assert.equal(checkCoverage(d).ok, false);

test("acepta los 10 municipios con variantes de escritura", () => {
  ok({ ciudad: "Monterrey", estado: "Nuevo León", cp: "64000" }, "monterrey");
  ok({ ciudad: "GUADALUPE", estado: "NL" }, "guadalupe");
  ok({ ciudad: "Ciudad Benito Juárez", estado: "Nuevo Leon", cp: "67250" }, "juarez");
  ok({ ciudad: "Cadereyta Jiménez" }, "cadereyta");
  ok({ ciudad: "Cd. Apodaca", cp: "66600" }, "apodaca");
  ok({ ciudad: "San Nicolás de los Garza" }, "sannicolas");
  ok({ ciudad: "Gral. Escobedo" }, "escobedo");
  ok({ ciudad: "García" }, "garcia");
  ok({ ciudad: "Santa Catarina" }, "santacatarina");
  ok({ ciudad: "San Pedro Garza García" }, "sanpedro");
});

test("San Pedro Garza García no se confunde con García", () => ok({ ciudad: "San Pedro Garza Garcia" }, "sanpedro"));

test("rechaza otros estados, CP fuera de NL y municipios fuera de zona", () => {
  no({ ciudad: "Saltillo", estado: "Coahuila", cp: "25000" });
  no({ ciudad: "Ciudad Juárez", estado: "Chihuahua", cp: "32500" });
  no({ ciudad: "Monterrey", cp: "25000" });
  no({ ciudad: "Allende", estado: "Nuevo León", cp: "67350" });
  no({ ciudad: "Santiago", estado: "Nuevo León" });
  no({ ciudad: "" });
});

test("Ciudad Juárez sin estado ni CP es ambiguo", () => {
  no({ ciudad: "Ciudad Juárez" });
  ok({ ciudad: "Ciudad Juárez", cp: "67250" }, "juarez");
});
