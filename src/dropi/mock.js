// Dropi falso para desarrollo y pruebas. Código de verificación: 123456.
const SAMPLE = [
  ["51201", "PENDIENTE", "Sofía Garza", "8111112233", "Calle Padre Mier 300, Centro", "Monterrey", "Nuevo León", "64000", "Faja moldeadora talla M", 549],
  ["51202", "PENDIENTE CONFIRMACION", "Iván Leal", "8122223344", "Av. Benito Juárez 55, Linda Vista", "Guadalupe", "Nuevo León", "67100", "Audífonos inalámbricos X9", 399],
  ["51203", "PENDIENTE", "Paola Ríos", "8443334455", "Blvd. Fundadores 800", "Saltillo", "Coahuila", "25000", "Cepillo alisador", 349],
  ["51204", "PENDIENTE", "Diego Salazar", "8133335566", "Calle Encino 12, Pueblo Nuevo", "Apodaca", "Nuevo León", "66646", "Lámpara LED recargable", 259],
  ["51205", "GUIA_GENERADA", "Andrea Peña", "8184445566", "Av. Universidad 1000, Anáhuac", "San Nicolás de los Garza", "Nuevo León", "66450", "Smartwatch deportivo", 649],
  ["51206", "PENDIENTE", "Mario Ortiz", "6566667788", "Av. Tecnológico 1500", "Ciudad Juárez", "Chihuahua", "32500", "Masajeador cervical", 459],
  ["51207", "PENDIENTE", "Valeria Cruz", "8125556677", "Calle Pino 9, Centro", "Allende", "Nuevo León", "67350", "Set de brochas 12 pzs", 289],
  ["51208", "PENDIENTE CONFIRMACION", "Emilio Rocha", "8146667788", "Av. Gómez Morín 900, Del Valle", "San Pedro Garza García", "Nuevo León", "66220", "Organizador de cocina", 219],
];

export function createMockClient({ failCancelFor = [] } = {}) {
  const orders = SAMPLE.map(([dropiId, estadoDropi, cliente, telefono, direccion, ciudad, estado, cp, producto, cod]) =>
    ({ dropiId, estadoDropi, cliente, telefono, direccion, ciudad, estado, cp, producto, cod }));
  return {
    orders,
    async login({ email, password }) {
      if (!email || !password || password.length < 4) { const e = new Error("Usuario o contraseña de Dropi incorrectos"); e.code = "auth"; throw e; }
      return { status: "needs_code", challenge: { email } };
    },
    async verify({ code }) {
      if (code !== "123456") { const e = new Error("El código no es válido o ya venció"); e.code = "code"; throw e; }
      return { status: "connected", token: "mock-token" };
    },
    async listOrders({ estados }) {
      return orders.filter((o) => estados.includes(o.estadoDropi)).map((o) => ({ ...o }));
    },
    async cancelOrder({ dropiId }) {
      if (failCancelFor.includes(dropiId)) { const e = new Error("Dropi no permitió cancelar el pedido"); e.code = "api"; throw e; }
      const o = orders.find((x) => x.dropiId === dropiId);
      if (o) o.estadoDropi = "CANCELADO";
      return { ok: true };
    },
  };
}
