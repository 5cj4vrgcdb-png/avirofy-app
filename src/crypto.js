import crypto from "node:crypto";

// Cifrado AES-256-GCM para credenciales de Dropi. Formato: v1.<iv>.<tag>.<datos> en base64url.
export function makeCipher(keyB64) {
  const key = Buffer.from(keyB64 || "", "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes en base64. Ver .env.example");
  return {
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
      return ["v1", iv, c.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
    },
    decrypt(blob) {
      const [v, iv, tag, data] = String(blob).split(".");
      if (v !== "v1") throw new Error("Formato de cifrado desconocido");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
    },
  };
}

// Contraseñas de usuarios de Avirofy: scrypt con sal aleatoria.
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split(".");
  if (alg !== "scrypt") return false;
  const exp = Buffer.from(hash, "base64url");
  const got = crypto.scryptSync(pw, Buffer.from(salt, "base64url"), exp.length);
  return crypto.timingSafeEqual(exp, got);
}
export const randomToken = (n = 32) => crypto.randomBytes(n).toString("base64url");
