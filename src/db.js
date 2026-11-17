import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MUNICIPIOS } from "./coverage.js";

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'dropshipper',  -- dropshipper | admin
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    -- Conexión de cada dropshipper a su cuenta de Dropi. Todo lo sensible va cifrado.
    CREATE TABLE IF NOT EXISTS dropi_connections (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      token_enc TEXT,
      challenge_enc TEXT,                 -- datos temporales del paso de verificación
      status TEXT NOT NULL,               -- needs_code | connected | expired | error
      last_error TEXT,
      connected_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      municipios TEXT NOT NULL,           -- JSON: claves de municipio
      estados TEXT NOT NULL,              -- JSON: estados de Dropi que se toman
      cancelar INTEGER NOT NULL DEFAULT 1,
      cada_minutos INTEGER NOT NULL DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      origen TEXT NOT NULL,               -- dropi | manual
      dropi_id TEXT,
      cliente TEXT NOT NULL,
      telefono TEXT,
      direccion TEXT,
      municipio TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Nuevo León',
      cp TEXT,
      producto TEXT,
      cod REAL NOT NULL DEFAULT 0,
      tarifa REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'recibido', -- recibido | bodega | ruta | entregado | novedad | cancelado
      dropi_cancel TEXT,                  -- null | pendiente | cancelado | error | no_aplica
      dropi_cancel_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, dropi_id)
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      revisados INTEGER DEFAULT 0,
      tomados INTEGER DEFAULT 0,
      error TEXT,
      events TEXT                         -- JSON con qué pasó con cada pedido
    );
  `);
  return db;
}

export const DEFAULT_RULES = {
  municipios: MUNICIPIOS.map((m) => m.key),
  estados: ["PENDIENTE CONFIRMACION", "PENDIENTE"],
  cancelar: true,
  cada_minutos: 15,
};

export function getRules(db, userId) {
  const r = db.prepare("SELECT * FROM rules WHERE user_id = ?").get(userId);
  if (!r) return { ...DEFAULT_RULES };
  return { municipios: JSON.parse(r.municipios), estados: JSON.parse(r.estados), cancelar: !!r.cancelar, cada_minutos: r.cada_minutos };
}

export function saveRules(db, userId, rules) {
  db.prepare(`INSERT INTO rules (user_id, municipios, estados, cancelar, cada_minutos) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET municipios=excluded.municipios, estados=excluded.estados, cancelar=excluded.cancelar, cada_minutos=excluded.cada_minutos`)
    .run(userId, JSON.stringify(rules.municipios), JSON.stringify(rules.estados), rules.cancelar ? 1 : 0, rules.cada_minutos);
}
