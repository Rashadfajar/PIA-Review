import { Router } from "express";
import multer from "multer";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

// --- Pastikan path upload konsisten & absolut ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDirEnv = process.env.UPLOAD_DIR || "uploads";

// Pastikan selalu di root project/backend, bukan src/
const uploadDirAbs = path.isAbsolute(uploadDirEnv)
  ? uploadDirEnv
  : path.resolve(__dirname, "..", "..", uploadDirEnv);

fs.mkdirSync(uploadDirAbs, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDirAbs),
  filename: (_req, file, cb) => {
    const safe = Date.now() + "_" + file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, safe);
  },
});


const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (atur sesuai kebutuhan)
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type. Only PDFs and images are allowed."));
  },
});

// helper absolute URL (opsional)
function toAbsoluteUrl(req, relativePath) {
  try {
    const origin =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;
    return new URL(relativePath, origin).toString();
  } catch {
    return relativePath;
  }
}

// daftar file
router.get("/", authRequired, async (req, res) => {
  try {
    const files = await prisma.file.findMany({
      where: {
        OR: [
          { ownerId: req.user.id },
          { isPublic: true },
          { access: { some: { userId: req.user.id } } },
        ],
      },
      include: {
        access: { select: { userId: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // opsional: tambahkan absoluteUrl ke respon
    const out = files.map((f) => ({
      ...f,
      absoluteUrl: toAbsoluteUrl(req, f.url),
    }));

    res.json(out);
  } catch (err) {
    console.error("Failed to fetch files:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// upload file
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const isPublic = req.body.isPublic === "true" || req.body.isPublic === true;

    let allowedEmails = [];
    const raw = req.body.allowedEmails;

    if (!isPublic) {
      if (Array.isArray(raw)) {
        allowedEmails = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          allowedEmails = Array.isArray(parsed) ? parsed : [raw];
        } catch {
          allowedEmails = [raw];
        }
      }
      allowedEmails = Array.from(new Set(allowedEmails.map((e) => e.trim()).filter(Boolean)));
    }

    const url = "/uploads/" + req.file.filename;

    const file = await prisma.file.create({
      data: {
        ownerId: req.user.id,
        name: req.file.filename,
        originalName: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
        url,
        isPublic,
      },
    });

    if (!isPublic && allowedEmails.length) {
      const users = await prisma.user.findMany({
        where: { email: { in: allowedEmails } },
        select: { id: true, email: true },
      });

      const foundIds = users.map((u) => u.id);
      const foundEmails = new Set(users.map((u) => u.email));
      const unknown = allowedEmails.filter((e) => !foundEmails.has(e));

      if (unknown.length) {
        return res.status(400).json({ error: `Unknown users: ${unknown.join(", ")}` });
      }

      const uniqueIds = Array.from(new Set(foundIds.filter((uid) => uid !== req.user.id)));
      if (uniqueIds.length) {
        await prisma.fileAccess.createMany({
          data: uniqueIds.map((uid) => ({ fileId: file.id, userId: uid })),
        });
      }
    }

    // tambahkan absoluteUrl (opsional)
    res.json({ ...file, absoluteUrl: toAbsoluteUrl(req, url) });
  } catch (err) {
    console.error("❌ File upload failed:", err);
    res.status(500).json({ error: "File upload failed" });
  }
});

// update akses
router.patch("/:id/access", authRequired, async (req, res) => {
  try {
    const file = await prisma.file.findUnique({ where: { id: req.params.id } });
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.ownerId !== req.user.id)
      return res.status(403).json({ error: "Forbidden" });

    const isPublic = req.body.isPublic === true || req.body.isPublic === "true";

    const updated = await prisma.file.update({
      where: { id: file.id },
      data: { isPublic },
    });

    if (!isPublic) {
      // (opsional) dukung string juga seperti POST
      const raw = req.body.allowedEmails;
      const emails = Array.isArray(raw)
        ? raw
        : (typeof raw === "string" && raw.trim()
            ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [raw]; } catch { return [raw]; } })()
            : []);

      const cleaned = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)));

      const users = await prisma.user.findMany({
        where: { email: { in: cleaned } },
        select: { id: true },
      });

      const ids = users.map((u) => u.id);
      await prisma.fileAccess.deleteMany({ where: { fileId: file.id } });

      const uniqueIds = Array.from(new Set(ids.filter((uid) => uid !== req.user.id)));
      if (uniqueIds.length) {
        await prisma.fileAccess.createMany({
          data: uniqueIds.map((uid) => ({ fileId: file.id, userId: uid })),
        });
      }
    } else {
      await prisma.fileAccess.deleteMany({ where: { fileId: file.id } });
    }

    res.json(updated);
  } catch (err) {
    console.error("Failed to update file access:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// hapus file
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const f = await prisma.file.findUnique({ where: { id: req.params.id } });
    if (!f) return res.status(404).json({ error: "File not found" });
    if (f.ownerId !== req.user.id)
      return res.status(403).json({ error: "Forbidden" });

    // Hapus file fisik
    if (f.url) {
      const base = path.basename(f.url);
      const filePath = path.join(uploadDirAbs, base); // gunakan path absolut yang sama
      try {
        await fsPromises.access(filePath);
        await fsPromises.unlink(filePath);
        console.log("Deleted file:", filePath);
      } catch (e) {
        console.warn("File not found or failed to delete:", filePath, e.message);
      }
    }

    await prisma.comment.deleteMany({ where: { fileId: f.id } });
    await prisma.fileAccess.deleteMany({ where: { fileId: f.id } });
    await prisma.file.delete({ where: { id: f.id } });

    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete file:", err.message);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

export default router;
