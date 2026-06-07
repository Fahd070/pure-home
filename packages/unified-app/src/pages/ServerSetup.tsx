import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import axios from "axios";

export default function ServerSetup() {
  const { serverUrl, setServerUrl } = useAppStore();
  const [url, setUrl] = useState(serverUrl);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleConnect() {
    setTesting(true); setStatus("idle"); setError("");
    const trimmed = url.trim().replace(/\/$/, "");
    try {
      const { data } = await axios.get(trimmed + "/health");
      if (data.status !== "ok") throw new Error("backend degraded");
      setServerUrl(trimmed);
      setStatus("ok");
      setTimeout(() => navigate("/"), 800);
    } catch {
      setStatus("error");
      setError("Cannot reach " + trimmed + " — check the IP and that the backend is running");
    } finally { setTesting(false); }
  }

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <button onClick={() => navigate("/")} className="text-slate-400 hover:text-slate-600 text-sm mb-4 flex items-center gap-1">
          ← Back / رجوع
        </button>

        <h1 className="text-xl font-bold mb-1">Server Setup / إعداد الخادم</h1>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Tailscale connection instructions:</p>
          <p>1. Ensure <strong>Tailscale</strong> is installed and connected on this PC.</p>
          <p>2. Ask your IT admin for the <strong>server's Tailscale hostname or IP</strong>.</p>
          <p>3. Enter it below as <code className="bg-slate-100 px-1 rounded">http://100.x.x.x:3001</code></p>
          <p className="text-slate-500">Or using hostname: <code className="bg-slate-100 px-1 rounded">http://server-pc.your-tailnet.ts.net:3001</code></p>
          <p>4. Click <strong>Test & Save</strong>. Green = connected.</p>
          <div className="border-t border-slate-200 pt-1 mt-1">
            <p className="font-semibold text-slate-700">إعداد أجهزة الموظفين عبر Tailscale:</p>
            <p>تأكد من تثبيت Tailscale ثم أدخل عنوان IP للخادم: <code className="bg-slate-100 px-1 rounded">http://100.x.x.x:3001</code></p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Server URL</label>
            <input
              value={url}
              onChange={e => { setUrl(e.target.value); setStatus("idle"); setError(""); }}
              placeholder="http://100.x.x.x:3001"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-slate-400 text-xs mt-1">
              This PC is currently using: <span className="font-mono text-slate-600">{serverUrl}</span>
            </p>
          </div>

          {status === "ok" && (
            <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
              <span>✓</span> Connected — redirecting...
            </div>
          )}
          {status === "error" && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleConnect}
            disabled={testing || !url.trim()}
            className="w-full bg-slate-800 text-white py-2 rounded-lg font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing connection..." : "Test & Save"}
          </button>

          <button
            onClick={() => { setServerUrl(url.trim().replace(/\/$/, "")); navigate("/"); }}
            className="w-full text-slate-500 text-sm hover:text-slate-700 transition-colors"
          >
            Save without testing
          </button>
        </div>
      </div>
    </div>
  );
}