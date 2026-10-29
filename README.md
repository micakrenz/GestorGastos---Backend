# Gestor de Gastos — backend

API REST en TypeScript con Express, Prisma y SQLite. La app móvil habla con Express por HTTP; Prisma es la única capa que accede a la base.

## Requisitos

- Node.js 20 o superior
- npm

## Inicio local

```sh
cd backend
npm install
cp .env.example .env
```

Editá `.env` y reemplazá `JWT_SECRET` por una cadena aleatoria larga. Después inicializá la base y levantá la API:

```sh
npm run db:init
npm run dev
```

La API queda en `http://localhost:3000`. `GET /api/health` permite comprobar que Express está activo. La primera inicialización crea `prisma/dev.db`.

## Rutas

Las rutas de cuenta son públicas. El resto requiere `Authorization: Bearer <token>`.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/health` | Estado de la API |
| POST | `/api/auth/register` | Crear cuenta con `name`, `email`, `password` |
| POST | `/api/auth/login` | Iniciar sesión con `email`, `password` |
| GET / PATCH | `/api/profile` | Leer o cambiar el nombre del perfil |
| GET / POST | `/api/expenses` | Listar o crear gastos; filtrar con `?year=2026&month=9` |
| PATCH / DELETE | `/api/expenses/:id` | Modificar o eliminar un gasto propio |
| GET / POST | `/api/incomes/:year/:month` | Leer o registrar ingresos una vez por mes |
| GET / PUT | `/api/budgets/:year/:month` | Leer o guardar presupuesto mensual y por categoría |
| GET / POST | `/api/goals` | Listar o crear objetivos |
| PATCH / DELETE | `/api/goals/:id` | Modificar o eliminar un objetivo propio |
| POST | `/api/goals/:id/movements` | Registrar un movimiento `ADD` o `SUBTRACT` |

Los importes se envían como números enteros en pesos (por ejemplo, `12500`), no como cadenas con símbolo o separadores. Las fechas se envían en formato ISO 8601. Cada consulta y operación de datos queda limitada al usuario autenticado.

## Contrato de gasto

```json
{
  "category": "Comida",
  "description": "Almuerzo",
  "amount": 12500,
  "date": "2026-10-25T12:45:00.000Z",
  "paymentMethod": "Tarjeta de débito",
  "note": "",
  "zone": "Caballito",
  "latitude": -34.62,
  "longitude": -58.44
}
```

La base guarda gastos con su fecha completa y los devuelve ordenados por fecha; el filtro mensual consulta el intervalo de fechas, sin crear una tabla por cada mes. Los ingresos se asocian al usuario y al año/mes, y solo se pueden registrar una vez para cada período. Los tokens de sesión deben guardarse en `expo-secure-store` en el cliente, no en AsyncStorage.

## Conexión desde el teléfono

En Expo Go, `localhost` apunta al teléfono. Para probar en un dispositivo físico, configurá el cliente con la IP local de la computadora (misma red Wi-Fi), por ejemplo `http://192.168.1.20:3000`.
