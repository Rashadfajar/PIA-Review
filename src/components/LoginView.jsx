import React, { useState } from "react";
import Button from "./ui/Button";
import { apiJson } from "./api"; // gunakan helper fetch kamu

export default function LoginView({ onLoginSuccess }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (loading) return;
    setMessage("");
    setIsError(false);
    setLoading(true);
    try {
      if (mode === "login") {
        const data = await apiJson("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        // BE balas: { token, user: { id, name, email } }
        localStorage.setItem("token", data.token);
        const displayName = data.user?.name || data.user?.email || "";
        localStorage.setItem("name", displayName);
        onLoginSuccess?.(data.token, displayName);
      } else {
        await apiJson("/auth/register", {
          method: "POST",
          body: { name, email, password },
        });
        setMode("login");
        setIsError(false);
        setMessage("Registration successful, please login.");
      }
    } catch (err) {
      setIsError(true);
      setMessage(err.message || "An error occurred");
    } finally {
      setLoading(false);
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

        <Button
          className={`w-full py-3 rounded-xl text-white ${
            loading ? "bg-gray-500" : "bg-black hover:bg-gray-900"
          }`}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Register"}
        </Button>

        <div className="text-sm text-center">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <Button
                className="text-blue-600 underline hover:text-blue-800"
                onClick={() => setMode("register")}
              >
                Register
              </Button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Button
                className="text-blue-600 underline hover:text-blue-800"
                onClick={() => setMode("login")}
              >
                Login
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
