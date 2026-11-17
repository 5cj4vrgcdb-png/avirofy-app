// Uso: npm run crear-usuario -- correo@tienda.com "Nombre de la tienda" [admin]
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { hashPassword, randomToken } from "../src/crypto.js";

const [email, name, role] = process.argv.slice(2);
if (!email || !name) { console.error('Uso: npm run crear-usuario -- correo@tienda.com "Nombre de la tienda" [admin]'); process.exit(1); }
const db = openDb(config.databasePath);
const temp = randomToken(9);
try {
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)").run(email.toLowerCase(), name, hashPassword(temp), role === "admin" ? "admin" : "dropshipper");
  console.log(`Usuario creado: ${email}\nContraseña temporal: ${temp}\nAl entrar se le pedirá cambiarla.`);
} catch (e) {
  console.error(/UNIQUE/.test(e.message) ? "Ese correo ya existe." : e.message); process.exit(1);
}
