// src/prisma.js
import { PrismaClient } from "@prisma/client";

// Membuat instance PrismaClient
let prisma;

// Jika lingkungan pengembangan (development), menggunakan instance global untuk menghindari pembukaan koneksi berulang
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

// Menangani penutupan koneksi dengan benar ketika aplikasi berhenti
async function shutdown() {
  await prisma.$disconnect();
}

process.on("SIGINT", shutdown);  // Menangani sinyal interrupt (Ctrl+C)
process.on("SIGTERM", shutdown); // Menangani sinyal terminasi (misalnya saat aplikasi dihentikan)

export { prisma };
