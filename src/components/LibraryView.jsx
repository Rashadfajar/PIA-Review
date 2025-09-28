import React, { useState, useEffect, useMemo } from "react";
import Button from "./ui/Button";
import axios from "axios";

const API_BASE = import.meta?.env?.VITE_API_URL || "http://localhost:4000";

export default function LibraryView({
  user,
  files = [],
  loading,
  onLogout,
  onOpen,
  onDelete,
  onFileUpload,
}) {
  // ===== State umum =====
  const [uploadError, setUploadError] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // ===== Upload-form state (dipindahkan ke modal) =====
  const [fileToUpload, setFileToUpload] = useState(null);
  const [isPublic, setIsPublic] = useState(true);
  const [allowedUserEmails, setAllowedUserEmails] = useState([]);

  // ===== Data user utk tagging (dimuat saat modal dibuka) =====
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [userSearch, setUserSearch] = useState("");

  // Normalisasi current user id -> string
  const currentUserId = useMemo(() => {
    const raw =
      user?.id ?? user?._id ?? user?.userId ?? user?.user?.id ?? user?.user?._id ?? "";
    const s = String(raw ?? "").trim();
    return s && s !== "undefined" && s !== "null" ? s : "";
  }, [user]);

  const isAdmin = user?.role === "admin";

  // Ambil users saat modal dibuka
  useEffect(() => {
    if (!showUploadModal) return;
    const controller = new AbortController();
    (async () => {
      try {
        setUsersLoading(true);
        setUsersError("");
        const token = localStorage.getItem("token");
        if (!token) {
          setUsersError("No auth token found.");
          return;
        }
        const res = await axios.get(`${API_BASE}/auth/users`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const list = (res.data || [])
          .filter((u) => u?.email)
          .map((u) => ({
            id: u.id || u._id || u.email,
            email: u.email,
            name: u.name,
          }));
        setAllUsers(list);
      } catch (err) {
        if (axios.isCancel(err)) return;
        console.error("Failed to load users:", err);
        if (err?.response?.status === 401 && onLogout) onLogout();
        setUsersError(err?.response?.data?.error || "Failed to load users.");
      } finally {
        setUsersLoading(false);
      }
    })();
    return () => controller.abort();
  }, [showUploadModal, onLogout]);

  // Filter user by query
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name && u.name.toLowerCase().includes(q))
    );
  }, [allUsers, userSearch]);

  // Toggle & utilities
  const toggleEmail = (email) => {
    setAllowedUserEmails((prev) =>
      prev.includes(email) ? prev.filter((em) => em !== email) : [...prev, email]
    );
  };
  const selectAllFiltered = () => {
    const emails = filteredUsers.map((u) => u.email);
    const merged = Array.from(new Set([...allowedUserEmails, ...emails]));
    setAllowedUserEmails(merged);
  };
  const clearAll = () => setAllowedUserEmails([]);

  // Submit upload
  const handleUploadSubmit = async (e) => {
    e?.preventDefault?.();
    if (!fileToUpload) {
      setUploadError("Please choose a file first.");
      return;
    }
    try {
      setIsUploading(true);
      setUploadError("");
      const formData = new FormData();
      formData.append("file", fileToUpload);
      formData.append("isPublic", String(isPublic));
      if (!isPublic && allowedUserEmails.length > 0) {
        allowedUserEmails.forEach((em) => formData.append("allowedEmails", em));
      }
      const token = localStorage.getItem("token");
      if (!token) {
        setUploadError("No auth token found.");
        setIsUploading(false);
        return;
      }
      const response = await axios.post(`${API_BASE}/files`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      onFileUpload?.(response.data);

      // Reset form + tutup modal
      setFileToUpload(null);
      setIsPublic(true);
      setAllowedUserEmails([]);
      setUserSearch("");
      setShowUploadModal(false);
    } catch (error) {
      console.error("Failed to upload file:", error);
      setUploadError(error.response?.data?.error || "Error uploading file. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) return <div>Loading files...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Library</h2>
          <Button
            className="px-3 py-1 border rounded-lg bg-white"
            onClick={() => {
              setUploadError("");
              setShowUploadModal(true);
            }}
          >
            Upload
          </Button>
        </div>

        {/* Files */}
        {files.length === 0 ? (
          <div className="text-center text-gray-500">
            No files found. Click <span className="font-medium">Upload</span> to add a PDF or image.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {files.map((file) => {
              const fileOwnerId = String(
                file?.ownerId ?? file?.owner_id ?? file?.owner?.id ?? ""
              );
              const isOwner = !!currentUserId && !!fileOwnerId && fileOwnerId === currentUserId;
              const canDelete = isOwner || isAdmin;

              const name = file?.originalName || file?.name || "Untitled";
              const created = file?.createdAt
                ? new Date(file.createdAt).toLocaleString()
                : "No date";

              const privateCount = file?.access?.length ?? 0;
              const privacyBadge = file?.isPublic
                ? { text: "Public", cls: "bg-green-100 text-green-700 border-green-200" }
                : { text: "Private" + (privateCount ? ` • ${privateCount}` : ""), cls: "bg-yellow-100 text-yellow-700 border-yellow-200" };

              return (
                <div
                  key={file?.id || file?._id || file?.url}
                  className="bg-white rounded-xl p-4 shadow flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{name}</div>
                    <div className="text-xs text-gray-500">{created}</div>
                    <div className="text-xs text-gray-400">
                      Owner: {file?.owner?.name || file?.owner?.email || "-"}
                    </div>
                    <span
                      className={`inline-block mt-2 text-xs px-2 py-0.5 rounded border ${privacyBadge.cls}`}
                    >
                      {privacyBadge.text}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      className="px-3 py-1 rounded-lg border"
                      onClick={() => onOpen?.(file)}
                    >
                      Open
                    </Button>
                    {canDelete && (
                      <Button
                        className="px-3 py-1 rounded-lg border text-red-600"
                        onClick={() => onDelete?.(file?.id || file?._id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Upload Modal ===== */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isUploading && setShowUploadModal(false)}
          />
          {/* Card */}
          <div className="relative z-10 w-full max-w-xl bg-white rounded-2xl shadow-lg">
            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold">Upload File</h3>
                <Button
                  type="Button"
                  className="text-gray-500 hover:text-black"
                  onClick={() => !isUploading && setShowUploadModal(false)}
                  disabled={isUploading}
                  aria-label="Close"
                >
                  ✕
                </Button>
              </div>

              {uploadError && (
                <div className="px-3 py-2 rounded bg-red-50 text-red-700 border border-red-200">
                  {uploadError}
                </div>
              )}

              {/* Pilih file */}
              <div>
                <label className="block mb-1 font-medium">Choose file</label>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => setFileToUpload(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={isUploading}
                />
                {fileToUpload && (
                  <div className="mt-1 text-xs text-gray-500">
                    Selected: {fileToUpload.name}
                  </div>
                )}
              </div>

              {/* Visibility */}
              <div className="flex items-center gap-3">
                <input
                  id="isPublicChk"
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => {
                    setIsPublic(e.target.checked);
                    if (e.target.checked) setAllowedUserEmails([]);
                  }}
                  disabled={isUploading}
                />
                <label htmlFor="isPublicChk" className="font-medium">
                  Make file Public
                </label>
                <span className="text-sm text-gray-500">
                  {isPublic ? "Anyone in the app can view." : "Only selected users can access."}
                </span>
              </div>

              {/* Private access picker */}
              {!isPublic && (
                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <label className="block font-medium">Grant access to users</label>
                    <div className="flex gap-2 text-sm">
                      <Button
                        type="Button"
                        className="px-2 py-1 border rounded bg-white"
                        onClick={selectAllFiltered}
                        disabled={usersLoading || filteredUsers.length === 0 || isUploading}
                      >
                        Select all (filtered)
                      </Button>
                      <Button
                        type="Button"
                        className="px-2 py-1 border rounded bg-white"
                        onClick={clearAll}
                        disabled={allowedUserEmails.length === 0 || isUploading}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Search name/email…"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    disabled={isUploading}
                  />

                  <div className="border rounded-lg p-2 max-h-56 overflow-y-auto bg-white">
                    {usersLoading && <div className="text-gray-500">Loading users…</div>}
                    {usersError && <div className="text-red-600">Error: {usersError}</div>}
                    {!usersLoading && !usersError && filteredUsers.length === 0 && (
                      <div className="text-gray-500">No users found.</div>
                    )}
                    {filteredUsers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowedUserEmails.includes(u.email)}
                          onChange={() => toggleEmail(u.email)}
                          disabled={isUploading}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm">{u.email}</span>
                          {u.name && <span className="text-xs text-gray-500">{u.name}</span>}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="text-sm text-gray-700">
                    Selected: {allowedUserEmails.length > 0 ? allowedUserEmails.join(", ") : "None"}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="Button"
                  className="px-3 py-2 border rounded-lg bg-white"
                  onClick={() => setShowUploadModal(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                  disabled={isUploading || !fileToUpload}
                >
                  {isUploading ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
