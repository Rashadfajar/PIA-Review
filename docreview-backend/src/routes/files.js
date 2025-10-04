import { Router } from "express";
import multer from "multer";
import { prisma } from "../prisma.js";
import { authRequired } from "../middleware/auth.js";
import { createClient } from "@supabase/supabase-js";

const router = Router();

/** ========= Supabase client ========= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = process.env.SUPABASE_BUCKET || "uploads";

/** ========= Multer: simpan di memory, bukan disk ========= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type. Only PDFs and images are allowed."));
  },
});

/** ========= Helper ========= */
// Buat path objek yang rapi & unik di bucket
function makeObjectPath(userId, originalName) {
  const ts = Date.now();
  const safe = (originalName || "file")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+/, "");
  return `docs/${userId || "public"}/${ts}_${safe}`;
}

// Ekstrak objectPath dari public URL Supabase (tanpa ubah skema DB)
// Contoh URL: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<objectPath>
function extractObjectPathFromPublicUrl(url) {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// (Opsional) jika kamu masih butuh absolute url builder, tapi sekarang file.url sudah absolute
function toAbsoluteUrl(_req, maybeAbsolute) {
  return maybeAbsolute; // sudah absolute dari Supabase
}

/** ========= LIST FILES ========= */
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

    const out = files.map((f) => ({
      ...f,
      absoluteUrl: toAbsoluteUrl(req, f.url), // sekarang f.url sudah public URL permanen
    }));

    res.json(out);
  } catch (err) {
    console.error("Failed to fetch files:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/** ========= UPLOAD FILE (to Supabase) ========= */
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const isPublic =
      req.body.isPublic === "true" || req.body.isPublic === true;

    // allowedEmails parsing (sama seperti sebelumnya)
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
      allowedEmails = Array.from(
        new Set(allowedEmails.map((e) => e.trim()).filter(Boolean))
      );
    }

    // === Upload ke Supabase Storage ===
    const objectPath = makeObjectPath(req.user?.id, req.file.originalname);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype || "application/octet-stream",
        upsert: false,
      });
    if (upErr) {
      console.error("Supabase upload error:", upErr.message);
      return res.status(500).json({ error: "Failed to upload to storage" });
    }

    // Public URL permanen dari bucket publik
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl;

    // Simpan metadata ke DB (tanpa ubah skema, kolom url = publicUrl)
    const file = await prisma.file.create({
      data: {
        ownerId: req.user.id,
        name: objectPath.split("/").pop(), // nama di storage
        originalName: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
        url: publicUrl, // <— permanen dari Supabase (public)
        isPublic, // kontrol akses aplikasi (bukan storage)
      },
    });

    // Access control (aplikasi) seperti sebelumnya
    if (!isPublic && allowedEmails.length) {
      const users = await prisma.user.findMany({
        where: { email: { in: allowedEmails } },
        select: { id: true, email: true },
      });

      const foundIds = users.map((u) => u.id);
      const foundEmails = new Set(users.map((u) => u.email));
      const unknown = allowedEmails.filter((e) => !foundEmails.has(e));

      if (unknown.length) {
        return res
          .status(400)
          .json({ error: `Unknown users: ${unknown.join(", ")}` });
      }

      const uniqueIds = Array.from(
        new Set(foundIds.filter((uid) => uid !== req.user.id))
      );
      if (uniqueIds.length) {
        await prisma.fileAccess.createMany({
          data: uniqueIds.map((uid) => ({ fileId: file.id, userId: uid })),
        });
      }
    }

    res.json({ ...file, absoluteUrl: publicUrl });
  } catch (err) {
    console.error("❌ File upload failed:", err);
    res.status(500).json({ error: "File upload failed" });
  }
});

/** ========= UPDATE AKSES (app-level) ========= */
router.patch("/:id/access", authRequired, async (req, res) => {
  try {
    const file = await prisma.file.findUnique({ where: { id: req.params.id } });
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.ownerId !== req.user.id)
      return res.status(403).json({ error: "Forbidden" });

    const isPublic =
      req.body.isPublic === true || req.body.isPublic === "true";

    const updated = await prisma.file.update({
      where: { id: file.id },
      data: { isPublic },
    });

    if (!isPublic) {
      const raw = req.body.allowedEmails;
      const emails = Array.isArray(raw)
        ? raw
        : (typeof raw === "string" && raw.trim()
            ? (() => {
                try {
                  const p = JSON.parse(raw);
                  return Array.isArray(p) ? p : [raw];
                } catch {
                  return [raw];
                }
              })()
            : []);

      const cleaned = Array.from(
        new Set(emails.map((e) => e.trim()).filter(Boolean))
      );

      const users = await prisma.user.findMany({
        where: { email: { in: cleaned } },
        select: { id: true },
      });

      const ids = users.map((u) => u.id);
      await prisma.fileAccess.deleteMany({ where: { fileId: file.id } });

      const uniqueIds = Array.from(
        new Set(ids.filter((uid) => uid !== req.user.id))
      );
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

/** ========= DELETE FILE (from Supabase) ========= */
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const f = await prisma.file.findUnique({ where: { id: req.params.id } });
    if (!f) return res.status(404).json({ error: "File not found" });
    if (f.ownerId !== req.user.id)
      return res.status(403).json({ error: "Forbidden" });

    // Hapus objek di Supabase Storage (ekstrak path dari public URL)
    const objectPath = extractObjectPathFromPublicUrl(f.url);
    if (objectPath) {
      const { error: delErr } = await supabase
        .storage
        .from(BUCKET)
        .remove([objectPath]);
      if (delErr) {
        console.warn("Storage remove warning:", delErr.message);
      }
    } else {
      console.warn("Cannot extract objectPath from URL:", f.url);
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
