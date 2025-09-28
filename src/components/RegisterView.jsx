// components/RegisterView.jsx
import React, { useState } from "react";
import axios from "axios";

export default function RegisterView({ onRegisterSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleRegister = async () => {
    try {
      const response = await axios.post("http://localhost:4000/auth/register", {
        email,
        password,
      });
      if (response.data.token) {
        // Simpan token di localStorage dan panggil onRegisterSuccess
        localStorage.setItem("token", response.data.token);
        onRegisterSuccess(response.data.token);
      }
    } catch (err) {
      setError("Registration failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold">Register</h1>
        <input
          type="email"
          placeholder="Email"
          className="w-full border rounded-lg p-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full border rounded-lg p-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button className="w-full py-2 rounded-xl bg-black text-white" onClick={handleRegister}>
          Register
        </button>
      </div>
    </div>
  );
}
