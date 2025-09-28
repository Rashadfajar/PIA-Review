import React, { useState } from "react";
import Button from "./ui/Button";
import axios from "axios";

export default function LoginView({ onLoginSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState(""); // bisa error atau sukses
  const [isError, setIsError] = useState(false); // true = error, false = sukses

  const handleSubmit = async () => {
    setMessage("");
    try {
      if (mode === "login") {
        // Handle login
        const response = await axios.post("http://localhost:4000/auth/login", { email, password });
        localStorage.setItem("token", response.data.token);
        localStorage.setItem("name", response.data.name);
        onLoginSuccess(response.data.token, response.data.name);
      } else {
        // Handle register
        await axios.post("http://localhost:4000/auth/register", { name, email, password });
        setMode("login");
        setIsError(false);
        setMessage("Registration successful, please login.");
      }
    } catch (err) {
      setIsError(true);
      setMessage(err.response?.data?.error || "An error occurred");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-blue-50 to-purple-50">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 space-y-6">
        <h1 className="text-3xl font-extrabold text-center text-gray-800">
          {mode === "login" ? "Login to PIA Review" : "Register New Account"}
        </h1>

        {message && (
          <div
            className={`p-2 text-center rounded ${
              isError ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
            }`}
          >
            {message}
          </div>
        )}

        {mode === "register" && (
          <input
            className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}

        <input
          className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button className="w-full py-3 rounded-xl bg-black text-white hover:bg-gray-900" onClick={handleSubmit}>
          {mode === "login" ? "Login" : "Register"}
        </Button>

        <div className="text-sm text-center">
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <Button className="text-blue-600 underline hover:text-blue-800" onClick={() => setMode("register")}>
                Register
              </Button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Button className="text-blue-600 underline hover:text-blue-800" onClick={() => setMode("login")}>
                Login
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
