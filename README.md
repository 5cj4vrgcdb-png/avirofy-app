# Avirofy

Plataforma para que los dropshippers de Dropi envíen a Avirofy sus pedidos con entrega local en Nuevo León.
Avirofy entrega solo en Monterrey, Guadalupe, Juárez, Cadereyta, Apodaca, San Nicolás, Escobedo, García,
Santa Catarina y San Pedro. Tarifa: $170 por entrega.

## Cómo funciona

1. Avirofy da de alta a cada dropshipper con su correo y una contraseña temporal.
2. El dropshipper entra, cambia su contraseña y conecta su cuenta de Dropi con usuario, contraseña y código de verificación.
3. Elige sus reglas: qué municipios (solo dentro de la cobertura), qué estados de Dropi se toman, si se cancela en Dropi y cada cuánto se revisa.
4. Cada cierto tiempo Avirofy revisa su Dropi, toma los pedidos que cumplen las reglas y están en cobertura, los guarda y los cancela en su Dropi.
   Los que no cumplen se quedan en Dropi sin cambios.
5. Si Dropi no deja cancelar un pedido, el pedido igual queda en Avirofy y el panel avisa que hay que cancelarlo a mano.

## Correr en tu computadora

Necesitas Node.js 22.13 o más nuevo.

```bash
npm install
cp .env.example .env
# Pon una llave en ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm run crear-usuario -- tienda@ejemplo.mx "Tienda Ejemplo"
npm run dev
```

Abre http://localhost:3000 y entra con la contraseña temporal que imprimió el comando.
En modo `DROPI_MODE=mock` se usa un Dropi falso con 8 pedidos de ejemplo; el código de verificación es `123456`.

## Pruebas

```bash
npm test
```

Cubren la regla de cobertura, la sincronización (tomar, no duplicar, respetar reglas, error al cancelar, sesión vencida) y el flujo completo de la API.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/coverage.js` | Regla de cobertura: estado Nuevo León, CP 64xxx a 67xxx y uno de los 10 municipios |
| `src/sync.js` | Revisa el Dropi de cada dropshipper, toma y cancela pedidos |
| `src/dropi/client.js` | Conexión real a Dropi con usuario, contraseña y código |
| `src/dropi/mock.js` | Dropi falso para desarrollo y pruebas |
| `src/app.js` | API: acceso, conexión a Dropi, reglas, sincronización, pedidos |
| `src/crypto.js` | Cifrado AES-256-GCM de credenciales de Dropi y contraseñas con scrypt |
| `src/db.js` | Base de datos SQLite (`node:sqlite`) |
| `public/` | Panel del dropshipper |

## Pendiente antes de usarlo con cuentas reales

- **Confirmar las rutas de Dropi México.** No hay documentación oficial pública. El login (`POST /login` con correo, contraseña
  y `white_brand_id`) viene de documentación no oficial; el paso del código, la lista de pedidos y la cancelación están
  configurados con rutas probables en `.env` (`DROPI_PATH_*`). Hay que probarlos con una cuenta real de Dropi y ajustarlos.
- **Hospedaje.** La app es un servidor Node que corre todo el tiempo (la revisión automática vive dentro del proceso)
  y guarda una base SQLite en disco. Sirve en Railway, Render o Fly.io con un disco persistente. No sirve tal cual en Netlify.
- **Panel interno de Avirofy** para cambiar el estado de los pedidos (bodega, ruta, entregado) y conectarlo con el admin actual.
- Shopify y ChateaPro aparecen como "Próximamente".
