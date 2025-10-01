import { prisma } from "../prisma.js";

/**
 * canAccessFile(userId, fileId)
 * Return shape:
 *  - { ok: true, file }
 *  - { ok: false, status: <number>, reason: <string> }
 */
export async function canAccessFile(userId, fileId) {
  try {
    // 1) Ambil info file duluan
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: { id: true, ownerId: true, isPublic: true },
    });

    if (!file) {
      return { ok: false, status: 404, reason: "Not found" };
    }

    // 2) File publik: siapa pun boleh akses
    if (file.isPublic) {
      return { ok: true, file };
    }

    // 3) Kalau tidak publik & tidak ada user -> tolak
    if (!userId) {
      return { ok: false, status: 403, reason: "Forbidden" };
    }

    // 4) Pemilik file -> ok
    if (file.ownerId === userId) {
      return { ok: true, file };
    }

    // 5) Validasi user hanya kalau diperlukan (ada userId)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return { ok: false, status: 400, reason: "Invalid user" };
    }

    // 6) Cek undangan/akses eksplisit (pastikan ada unique composite di schema)
    const invited = await prisma.fileAccess.findUnique({
      where: { fileId_userId: { fileId: file.id, userId } },
      select: { fileId: true }, // minimal payload
    });

    if (invited) {
      return { ok: true, file };
    }

    // 7) Default: tolak
    return { ok: false, status: 403, reason: "Forbidden" };
  } catch (err) {
    console.error("canAccessFile error:", err);
    return { ok: false, status: 500, reason: "Internal Server Error" };
  }
}
