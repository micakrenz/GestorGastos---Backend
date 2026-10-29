import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { AuthRequest, requireAuth } from "./middleware/auth";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const emailSchema = z.string().trim().email().max(254);
const positiveAmount = z.number().int().positive();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    email: emailSchema,
    password: z.string().min(8).max(72),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá un email válido y una contraseña de al menos 8 caracteres." });

  const email = parsed.data.email.toLowerCase();
  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: "Ya existe una cuenta con ese email." });

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name || email.split("@")[0],
        email,
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: "Falta configurar JWT_SECRET." });
    const token = jwt.sign({}, secret, { subject: String(user.id), expiresIn: "7d" });
    return res.status(201).json({ user, token });
  } catch {
    return res.status(500).json({ error: "No se pudo crear la cuenta." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(72) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email o contraseña inválidos." });
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: "Email o contraseña incorrectos." });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: "Falta configurar JWT_SECRET." });
    const token = jwt.sign({}, secret, { subject: String(user.id), expiresIn: "7d" });
    return res.json({ user: { id: user.id, name: user.name, email: user.email }, token });
  } catch {
    return res.status(500).json({ error: "No se pudo iniciar sesión." });
  }
});

app.get("/api/profile", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: "No se encontró el perfil." });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: "No se pudo leer el perfil." });
  }
});

app.patch("/api/profile", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "El nombre es obligatorio (máximo 80 caracteres)." });
  try {
    const user = await prisma.user.update({ where: { id: req.userId! }, data: { name: parsed.data.name }, select: { id: true, name: true, email: true } });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: "No se pudo actualizar el perfil." });
  }
});

const expenseInput = z.object({
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(120),
  amount: positiveAmount,
  date: z.coerce.date(),
  paymentMethod: z.string().trim().min(1).max(60),
  note: z.string().trim().max(500).optional(),
  zone: z.string().trim().max(120).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

app.get("/api/expenses", requireAuth, async (req: AuthRequest, res) => {
  const year = req.query.year === undefined ? undefined : Number(req.query.year);
  const month = req.query.month === undefined ? undefined : Number(req.query.month);
  if ((year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2200)) || (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) || (month !== undefined && year === undefined)) {
    return res.status(400).json({ error: "Usá un año válido y, si indicás mes, un mes entre 1 y 12." });
  }
  const dateFilter = year === undefined ? {} : month === undefined
    ? { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }
    : { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
  try {
    const expenses = await prisma.expense.findMany({ where: { userId: req.userId!, ...(year === undefined ? {} : { date: dateFilter }) }, orderBy: [{ date: "desc" }, { id: "desc" }] });
    return res.json(expenses);
  } catch {
    return res.status(500).json({ error: "No se pudieron leer los gastos." });
  }
});

app.post("/api/expenses", requireAuth, async (req: AuthRequest, res) => {
  const parsed = expenseInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revisá los datos del gasto.", details: parsed.error.flatten() });
  try {
    const expense = await prisma.expense.create({ data: { ...parsed.data, userId: req.userId!, note: parsed.data.note ?? "", zone: parsed.data.zone ?? "" } });
    return res.status(201).json(expense);
  } catch {
    return res.status(500).json({ error: "No se pudo guardar el gasto." });
  }
});

app.patch("/api/expenses/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "El id del gasto no es válido." });
  const parsed = expenseInput.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return res.status(400).json({ error: "Enviá al menos un campo válido para modificar." });
  try {
    const result = await prisma.expense.updateMany({ where: { id, userId: req.userId! }, data: parsed.data });
    if (result.count === 0) return res.status(404).json({ error: "No se encontró el gasto." });
    return res.json(await prisma.expense.findUnique({ where: { id } }));
  } catch {
    return res.status(500).json({ error: "No se pudo actualizar el gasto." });
  }
});

app.delete("/api/expenses/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "El id del gasto no es válido." });
  try {
    const result = await prisma.expense.deleteMany({ where: { id, userId: req.userId! } });
    if (result.count === 0) return res.status(404).json({ error: "No se encontró el gasto." });
    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: "No se pudo eliminar el gasto." });
  }
});

app.get("/api/incomes/:year/:month", requireAuth, async (req: AuthRequest, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "Año o mes no válido." });
  }
  try {
    const income = await prisma.income.findUnique({ where: { userId_year_month: { userId: req.userId!, year, month } } });
    return res.json({ year, month, amount: income?.amount ?? 0, registered: Boolean(income) });
  } catch {
    return res.status(500).json({ error: "No se pudieron leer los ingresos." });
  }
});

app.post("/api/incomes/:year/:month", requireAuth, async (req: AuthRequest, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const parsed = z.object({ amount: positiveAmount }).safeParse(req.body);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || !parsed.success) {
    return res.status(400).json({ error: "Revisá el período y el importe de los ingresos." });
  }
  try {
    const existing = await prisma.income.findUnique({ where: { userId_year_month: { userId: req.userId!, year, month } } });
    if (existing) return res.status(409).json({ error: "Ya registraste tus ingresos para este mes." });
    const income = await prisma.income.create({ data: { userId: req.userId!, year, month, amount: parsed.data.amount } });
    return res.status(201).json({ year: income.year, month: income.month, amount: income.amount, registered: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return res.status(409).json({ error: "Ya registraste tus ingresos para este mes." });
    }
    return res.status(500).json({ error: "No se pudieron guardar los ingresos." });
  }
});

app.get("/api/budgets/:year/:month", requireAuth, async (req: AuthRequest, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: "Año o mes no válido." });
  try {
    const budget = await prisma.budget.findUnique({ where: { userId_year_month: { userId: req.userId!, year, month } }, include: { categories: true } });
    return res.json(budget ?? { year, month, monthly: 0, categories: [] });
  } catch {
    return res.status(500).json({ error: "No se pudo leer el presupuesto." });
  }
});

app.put("/api/budgets/:year/:month", requireAuth, async (req: AuthRequest, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const parsed = z.object({ monthly: z.number().int().nonnegative(), categories: z.record(z.string().trim().min(1).max(60), z.number().int().nonnegative()) }).safeParse(req.body);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || !parsed.success) return res.status(400).json({ error: "Revisá el período y los importes del presupuesto." });
  try {
    const budget = await prisma.budget.upsert({
      where: { userId_year_month: { userId: req.userId!, year, month } },
      create: { userId: req.userId!, year, month, monthly: parsed.data.monthly, categories: { create: Object.entries(parsed.data.categories).map(([category, amount]) => ({ category, amount })) } },
      update: { monthly: parsed.data.monthly, categories: { deleteMany: {}, create: Object.entries(parsed.data.categories).map(([category, amount]) => ({ category, amount })) } },
      include: { categories: true },
    });
    return res.json(budget);
  } catch {
    return res.status(500).json({ error: "No se pudo guardar el presupuesto." });
  }
});

async function listGoals(userId: number) {
  const goals = await prisma.goal.findMany({ where: { userId }, include: { movements: { orderBy: { date: "desc" } } }, orderBy: { createdAt: "asc" } });
  return goals.map(({ movements, ...goal }) => ({ ...goal, current: movements.reduce((total, movement) => total + (movement.type === "ADD" ? movement.amount : -movement.amount), 0), movements }));
}

app.get("/api/goals", requireAuth, async (req: AuthRequest, res) => {
  try { return res.json(await listGoals(req.userId!)); }
  catch { return res.status(500).json({ error: "No se pudieron leer los objetivos." }); }
});

app.post("/api/goals", requireAuth, async (req: AuthRequest, res) => {
  const parsed = z.object({ title: z.string().trim().min(1).max(100), target: positiveAmount, initialAmount: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success || (parsed.data.initialAmount ?? 0) > parsed.data.target) return res.status(400).json({ error: "Revisá el nombre, el objetivo y el ahorro inicial." });
  try {
    const goal = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.goal.create({
        data: {
          userId: req.userId!,
          title: parsed.data.title,
          target: parsed.data.target,
          ...(parsed.data.initialAmount ? { movements: { create: { amount: parsed.data.initialAmount, type: "ADD", date: now } } } : {}),
        },
        include: { movements: true },
      });
      if (parsed.data.initialAmount) {
        await tx.expense.create({
          data: {
            userId: req.userId!,
            category: "Objetivos",
            description: `Aporte a ${created.title}`,
            amount: parsed.data.initialAmount,
            date: now,
            paymentMethod: "Ahorro",
            note: `Aporte inicial al objetivo: ${created.title}`,
          },
        });
      }
      return created;
    });
    return res.status(201).json({ ...goal, current: parsed.data.initialAmount ?? 0 });
  } catch { return res.status(500).json({ error: "No se pudo crear el objetivo." }); }
});

app.patch("/api/goals/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ title: z.string().trim().min(1).max(100).optional(), target: positiveAmount.optional() }).refine((data) => Object.keys(data).length > 0).safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: "Revisá el id y los datos del objetivo." });
  try {
    const result = await prisma.goal.updateMany({ where: { id, userId: req.userId! }, data: parsed.data });
    if (!result.count) return res.status(404).json({ error: "No se encontró el objetivo." });
    return res.json((await listGoals(req.userId!)).find((goal) => goal.id === id));
  } catch { return res.status(500).json({ error: "No se pudo actualizar el objetivo." }); }
});

app.delete("/api/goals/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "El id del objetivo no es válido." });
  try {
    const result = await prisma.goal.deleteMany({ where: { id, userId: req.userId! } });
    if (!result.count) return res.status(404).json({ error: "No se encontró el objetivo." });
    return res.status(204).end();
  } catch { return res.status(500).json({ error: "No se pudo eliminar el objetivo." }); }
});

app.post("/api/goals/:id/movements", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ amount: positiveAmount, type: z.enum(["ADD", "SUBTRACT"]), date: z.coerce.date().optional(), note: z.string().trim().max(300).optional() }).safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: "Revisá el objetivo y el movimiento." });
  try {
    const goal = await prisma.goal.findFirst({ where: { id, userId: req.userId! }, include: { movements: true } });
    if (!goal) return res.status(404).json({ error: "No se encontró el objetivo." });
    const current = goal.movements.reduce((total, movement) => total + (movement.type === "ADD" ? movement.amount : -movement.amount), 0);
    if (parsed.data.type === "SUBTRACT" && parsed.data.amount > current) return res.status(400).json({ error: "El movimiento supera el ahorro actual." });
    const movementDate = parsed.data.date ?? new Date();
    const movement = await prisma.$transaction(async (tx) => {
      const savedMovement = await tx.goalMovement.create({ data: { goalId: id, ...parsed.data, date: movementDate, note: parsed.data.note ?? "" } });
      if (savedMovement.type === "ADD") {
        await tx.expense.create({
          data: {
            userId: req.userId!,
            category: "Objetivos",
            description: `Aporte a ${goal.title}`,
            amount: savedMovement.amount,
            date: savedMovement.date,
            paymentMethod: "Ahorro",
            note: [`Aporte al objetivo: ${goal.title}`, savedMovement.note].filter(Boolean).join(" · "),
          },
        });
      }
      return savedMovement;
    });
    const newCurrent = current + (movement.type === "ADD" ? movement.amount : -movement.amount);
    return res.status(201).json({ movement, current: newCurrent });
  } catch { return res.status(500).json({ error: "No se pudo guardar el movimiento." }); }
});

app.use((_req, res) => res.status(404).json({ error: "La ruta solicitada no existe." }));

app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
