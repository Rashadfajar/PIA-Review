import React, { useEffect, useState } from "react";
import LoginView from "./components/LoginView";
import LibraryView from "./components/LibraryView";
import PdfWorkspace from "./components/PdfWorkspace";
import Button from "./components/ui/Button";
import { apiJson } from "./components/api"; 

function App() {
  const [user, setUser] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [openFile, setOpenFile] = useState(null);
  const [error, setError] = useState(null);

  const sanitizeId = (v) => {
    const s = String(v ?? "").trim();
    return s && s !== "undefined" && s !== "null" ? s : "";
  };

  // Load profil jika sudah ada token di localStorage
  useEffect(() => {
    const token = localStorage.getItem("token") || "";
    const name = localStorage.getItem("name") || "";
    const rawId = localStorage.getItem("id");
    const id = sanitizeId(rawId);

    if (!token) return;

    (async () => {
      try {
        const me = await apiJson("/auth/me");
        const finalId = sanitizeId(me.id || me._id || id);
        setUser({
          token,
          name: me.name || name || "",
          id: finalId,
          role: me.role,
          email: me.email,
        });
        localStorage.setItem("name", me.name || name || "");
        if (finalId) localStorage.setItem("id", finalId);
      } catch (e) {
        console.error("Failed to fetch /auth/me:", e);
        if (id) {
          setUser({ token, name, id });
        } else {
          localStorage.clear();
          setUser(null);
        }
      }
    })();
  }, []);

  // Dipanggil setelah LoginView sukses
  const handleLoginSuccess = async (token, nameMaybe, idMaybe) => {
    try {
      localStorage.setItem("token", token);
      if (nameMaybe) localStorage.setItem("name", nameMaybe);

      const me = await apiJson("/auth/me");
      const finalId = sanitizeId(me.id || me._id || idMaybe);

      setUser({
        token,
        name: me.name || nameMaybe || "",
        id: finalId,
        role: me.role,
        email: me.email,
      });

      localStorage.setItem("name", me.name || nameMaybe || "");
      if (finalId) localStorage.setItem("id", finalId);
    } catch (e) {
      console.error("Failed to fetch /auth/me after login:", e);
      const safeId = sanitizeId(idMaybe);
      setUser({ token, name: nameMaybe || "", id: safeId });
      if (nameMaybe) localStorage.setItem("name", nameMaybe);
      if (safeId) localStorage.setItem("id", safeId);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.clear();
  };

  // Ambil daftar file setelah user tersedia
  useEffect(() => {
    if (!user?.token) return;
    (async () => {
      setLoadingFiles(true);
      setError(null);
      try {
        const data = await apiJson("/files");
        setFiles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load files:", err);
        setError("Gagal memuat file. Cek API atau token.");
      } finally {
        setLoadingFiles(false);
      }
    })();
  }, [user?.token]);

  if (!user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  if (openFile) {
    return (
      <PdfWorkspace
        user={user}
        file={openFile}
        onBack={() => setOpenFile(null)}
      />
    );
  }

  const handleFileUpload = (file) => {
    setFiles((prev) => [file, ...prev]);
  };

  const handleDelete = async (fileId) => {
    try {
      await apiJson(`/files/${fileId}`, { method: "DELETE" });
      setFiles((prev) =>
        prev.filter((file) => (file.id || file._id) !== fileId)
      );
    } catch (err) {
      console.error("Failed to delete file:", err);
      setError("Gagal menghapus file.");
    }
  };

  return (
    <div className="min-h-screen">
      <div className="h-16 border-b flex items-center justify-between px-10">
        <div className="flex items-center gap-2">
          <img
            src="/logo-piarea.jpeg"
            alt="PI AREA Logo"
            className="h-10 w-10 object-contain"
          />
          <span className="font-semibold text-lg">PIAREA</span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span>{user?.name || "Guest"}</span>
          <Button className="px-3 py-1 border rounded-lg" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-100 text-red-600 text-sm">{error}</div>
      )}

      <LibraryView
        user={user}
        files={files}
        loading={loadingFiles}
        onLogout={handleLogout}
        onOpen={setOpenFile}
        onFileUpload={handleFileUpload}
        onDelete={handleDelete}
      />
    </div>
  );
}

export default App;
