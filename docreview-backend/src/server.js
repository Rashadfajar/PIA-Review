import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

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
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

/* ========= Static uploads (ABSOLUTE & CONSISTENT) ========= */
const uploadDirEnv = process.env.UPLOAD_DIR || "uploads";// gunakan "uploads" (tanpa ./) sebagai default
const UPLOAD_DIR_ABS = path.isAbsolute(uploadDirEnv)
  ? uploadDirEnv
  : path.resolve(__dirname, "..", uploadDirEnv);

console.log("📁 Serving uploads from:", UPLOAD_DIR_ABS);
app.use("/uploads", express.static(UPLOAD_DIR_ABS));

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
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// 🔐 autentikasi JWT 
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
