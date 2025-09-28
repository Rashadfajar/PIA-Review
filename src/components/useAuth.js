import { useState, useEffect } from "react";

export function useAuth() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const name = localStorage.getItem("name"); // Ambil nama pengguna dari localStorage
    if (token && name) {
      setUser({ token, name }); // Simpan token dan nama pengguna
    }
  }, []);

  const login = (token, name) => {
    setUser({ token, name });
    localStorage.setItem("token", token);
    localStorage.setItem("name", name); // Simpan nama pengguna
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("name");
  };

  return { user, login, logout };
}
