import { prisma } from "../prisma.js";

// Fungsi untuk mengambil data file dari database
async function getFile(fileId) {
  return await prisma.file.findUnique({
    where: { id: fileId },
    select: { ownerId: true, isPublic: true, id: true }
  });
}

// Fungsi untuk memeriksa apakah pengguna sudah diundang untuk mengakses file
async function checkInvitedAccess(fileId, userId) {
  const invited = await prisma.fileAccess.findUnique({
    where: { fileId_userId: { fileId, userId } }
  });
  return invited !== null;
}

// Fungsi untuk memvalidasi apakah pengguna ada di database
async function validateUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  return user !== null;
}

// Fungsi utama untuk memeriksa akses pengguna ke file
export async function canAccessFile(userId, fileId) {
  // Validasi pengguna
  const userValid = await validateUser(userId);
  if (!userValid) {
    return { ok: false, status: 400, reason: "Invalid user" };
  }

  // Ambil data file
  let file;
  try {
    file = await getFile(fileId);
  } catch (error) {
    console.error("Error fetching file:", error);
    return { ok: false, status: 500, reason: "Internal Server Error" };
  }

  // Jika file tidak ditemukan
  if (!file) {
    return { ok: false, status: 404, reason: "Not found" };
  }

  // Cek apakah pengguna adalah pemilik file, file publik, atau sudah diundang
  const canAccess = file.ownerId === userId || file.isPublic || await checkInvitedAccess(fileId, userId);

  if (canAccess) {
    return { ok: true, file };
  }

  // Jika akses ditolak
  return { ok: false, status: 403, reason: "Forbidden" };
}
