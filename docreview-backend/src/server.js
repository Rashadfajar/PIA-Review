import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

import authRoutes from "./routes/auth.js";
import fileRoutes from "./routes/files.js";
import commentRoutes from "./routes/comments.js";
import sectionRoutes from "./routes/sections.js";
import { authOptional } from "./middleware/auth.js";
import { verifyJwt } from "./Lib/verifyJwt.js";
import { canAccessFile } from "./Lib/canAccessFile.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ========= Security & parsing ========= */
app.use(express.json({ limit: "10mb" }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS: allow localhost + production(s)
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  process.env.CLIENT_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow requests without Origin (curl/health checks)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(rateLimit({ windowMs: 60_000, max: 300 }));

/* ========= (No more static /uploads; files live in Supabase) ========= */
// If you still want to keep it harmlessly:
// app.use("/uploads", express.static(path.resolve(__dirname, "..", "uploads")));

/* ========= Health ========= */
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ========= Routes ========= */
app.use("/auth", authRoutes);
app.use("/files", authOptional, fileRoutes);
app.use("/comments", authOptional, commentRoutes);
app.use("/sections", authOptional, sectionRoutes);

/* ========= Socket.IO setup ========= */
const server = http.createServer(app);

export const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// 🔐 autentikasi JWT untuk Socket.IO
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = verifyJwt(token);
    if (!user?.id) return next(new Error("unauthorized"));
    socket.user = { id: user.id, name: user.name };
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

// cek akses saat join room per file
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, "user:", socket.user?.id);

  socket.on("joinFile", async ({ fileId }) => {
    if (!fileId) return;
    try {
      const access = await canAccessFile(socket.user.id, fileId);
      if (!access.ok) {
        socket.emit("joinError", { fileId, reason: access.reason });
        return;
      }
      socket.join(`file_${fileId}`);
    } catch {
      socket.emit("joinError", { fileId, reason: "Internal error" });
    }
  });

  socket.on("leaveFile", ({ fileId }) => {
    if (fileId) socket.leave(`file_${fileId}`);
  });
});

/* ========= Start ========= */
const port = Number(process.env.PORT || 4000);
server.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
