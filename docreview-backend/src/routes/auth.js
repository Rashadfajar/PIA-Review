import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const normEmail = (e) => String(e || "").trim().toLowerCase();
const sign = (payload, exp = "7d") =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: exp });

/* GET /auth/me */
router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  } catch (err) {
    console.error("Failed /auth/me:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* POST /auth/register */
router.post("/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: "Email already in use" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: passwordHash }, // <-- pakai kolom 'password'
      select: { id: true, name: true, email: true },
    });

    return res.status(201).json({ message: "User registered", user });
  } catch (err) {
    console.error("Registration failed:", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

/* POST /auth/login */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Ambil user + hash
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, password: true },
    });

    // Jangan pernah 500 untuk kredensial salah
    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Bandingkan bcrypt
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Pastikan JWT_SECRET ada → kalau tidak, ini bisa bikin 500
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 10) {
      console.error("JWT_SECRET is missing or too short");
      return res.status(500).json({ error: "Server misconfigured" });
    }

    // Sign token
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    // Tampilkan akar error ke terminal biar gampang trace
    console.error("Error /auth/login:", err?.message, err?.stack);
    return res.status(500).json({ error: "Login failed" });
  }
});


/* POST /auth/change-password */
router.post("/change-password", authRequired, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, password: true }, // <-- 'password'
    });
    if (!user || !user.password) {
      return res.status(400).json({ error: "User not found" });
    }

    const ok = await bcrypt.compare(String(oldPassword || ""), user.password);
    if (!ok) return res.status(400).json({ error: "Invalid current password" });

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: newHash }, // <-- 'password'
    });

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Password change failed:", err);
    return res.status(500).json({ error: "Password change failed" });
  }
});

/* (opsional) GET /auth/users */
router.get("/users", authRequired, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true },
    });
    return res.json(users);
  } catch (err) {
    console.error("List users failed:", err);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
