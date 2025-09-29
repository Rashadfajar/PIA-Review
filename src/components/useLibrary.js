import { useEffect, useState } from "react";
import { apiJson, apiForm } from "./api";

export function useLibrary() {
  const [files, setFiles] = useState([]);

  const refresh = async () => {
    try {
      const data = await apiJson("/files");
      setFiles(data || []);
    } catch (e) {
      setFiles([]);
    }
  };

  useEffect(() => {
    if (localStorage.getItem("token")) refresh();
  }, []);

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const saved = await apiForm("/files", fd); 
    setFiles((prev) => [saved, ...prev]);
    return saved;
  };

  const removeFile = async (id) => {
    await apiJson(`/files/${id}`, { method: "DELETE" });
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return { files, refresh, uploadFile, removeFile };
}
