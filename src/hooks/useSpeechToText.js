// src/hooks/useSpeechToText.js
import { useEffect, useRef, useState } from "react";

/**
 * useSpeechToText
 * Klik sekali -> mic ON, klik lagi -> mic OFF.
 * Fitur: auto-restart (no-speech/network), backoff, permission preflight, visibility pause.
 */
export default function useSpeechToText({
  lang = "id-ID",
  interim = true,
  continuous = true,
  autoRestart = true,
  preflight = true,       // coba getUserMedia agar izin mic jelas
  onFinal,                // (text) => void
  onInterim,              // (text) => void
} = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState(null);

  const recogRef = useRef(null);
  const userStoppedRef = useRef(false);
  const mountedRef = useRef(false);

  const restartTimerRef = useRef(null);
  const backoffRef = useRef(400); // ms: akan naik sampai 5000ms
  const lastActivityRef = useRef(0);
  const wasListeningBeforeHideRef = useRef(false);
  const startingRef = useRef(false); // cegah double start

  const cbRef = useRef({ onFinal, onInterim });
  cbRef.current.onFinal = onFinal;
  cbRef.current.onInterim = onInterim;

  const FATAL_ERRORS = new Set([
    "not-allowed",
    "service-not-allowed",
    "language-not-supported",
  ]);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const scheduleRestart = (reason) => {
    if (!autoRestart || userStoppedRef.current) return;
    clearRestartTimer();

    // Naikkan backoff jika tidak ada aktivitas suara lama
    const now = Date.now();
    const hadRecentActivity = now - lastActivityRef.current < 15000; // 15s
    if (!hadRecentActivity) backoffRef.current = Math.min(backoffRef.current * 1.8, 5000);
    else backoffRef.current = 400;

    restartTimerRef.current = setTimeout(() => {
      if (!userStoppedRef.current) safeStart().catch(() => {});
    }, backoffRef.current);
  };

  const safeStart = async () => {
    if (!recogRef.current || startingRef.current) return;
    startingRef.current = true;
    setError(null);

    // Optional preflight untuk izin mic (lebih jelas UX-nya)
    if (preflight && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // segera hentikan track (kita hanya perlu permission)
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        setError(e?.name || "mic-permission-error");
        startingRef.current = false;
        return;
      }
    }

    try {
      userStoppedRef.current = false;
      lastActivityRef.current = Date.now();
      recogRef.current.start();
    } catch (e) {
      // Chrome melempar error jika start dipanggil saat already started
      // atau tanpa gesture, kita abaikan ringan & jadwalkan ulang
      scheduleRestart("start-exception");
    } finally {
      // biarkan onstart yang set listening=true
      // release flag sedikit lebih lambat agar double click tidak racing
      setTimeout(() => { startingRef.current = false; }, 50);
    }
  };

  const safeStop = () => {
    userStoppedRef.current = true;
    clearRestartTimer();
    setInterimText("");
    setListening(false);
    setError(null);
    try { recogRef.current?.stop(); } catch {}
    // Abort sebagai fallback jika stop() tidak memicu onend
    setTimeout(() => { try { recogRef.current?.abort(); } catch {} }, 150);
  };

  const toggle = () => (listening ? safeStop() : safeStart());

  useEffect(() => {
    mountedRef.current = true;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return () => { mountedRef.current = false; };
    }
    setSupported(true);

    const r = new SR();
    r.lang = lang;
    r.interimResults = interim;
    r.continuous = continuous;
    r.maxAlternatives = 1;

    r.onstart = () => {
      if (!mountedRef.current) return;
      setListening(true);
      setError(null);
      lastActivityRef.current = Date.now();
      backoffRef.current = 400;
    };

    r.onresult = (e) => {
      lastActivityRef.current = Date.now();
      let interimBuf = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i];
        const txt = seg[0]?.transcript || "";
        if (seg.isFinal) {
          cbRef.current.onFinal?.(txt.trim());
        } else {
          interimBuf += txt;
        }
      }
      setInterimText(interimBuf.trim());
      cbRef.current.onInterim?.(interimBuf.trim());
    };

    r.onerror = (ev) => {
      if (!mountedRef.current) return;
      setError(ev?.error || "unknown-error");
      setListening(false);

      if (!FATAL_ERRORS.has(ev?.error)) {
        scheduleRestart(`onerror:${ev?.error}`);
      }
    };

    r.onend = () => {
      if (!mountedRef.current) return;
      setListening(false);
      // Kalau berhenti karena user -> tidak auto-restart
      if (!userStoppedRef.current) scheduleRestart("onend");
    };

    // Optional: saat tab disembunyikan, jeda sementara supaya tidak error
    const onVisibility = () => {
      if (document.hidden) {
        wasListeningBeforeHideRef.current = listening;
        if (listening) safeStop();
      } else if (wasListeningBeforeHideRef.current) {
        wasListeningBeforeHideRef.current = false;
        if (!userStoppedRef.current) safeStart();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    recogRef.current = r;
    return () => {
      mountedRef.current = false;
      clearRestartTimer();
      try { r.onstart = r.onresult = r.onerror = r.onend = null; } catch {}
      try { r.abort(); } catch {}
      recogRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-init hanya bila parameter inti berubah
  }, [lang, interim, continuous, autoRestart, preflight]);

  return {
    supported,
    listening,
    interimText,
    error,
    start: safeStart,
    stop: safeStop,
    toggle,
    setInterimText, // opsional: jika ingin reset manual
  };
}
