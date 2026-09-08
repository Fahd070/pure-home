import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import axios from "axios";
import { Button } from "../ui/Button";
import { Input, Field } from "../ui/Field";
import { Callout } from "../ui/Feedback";
import { Icon } from "../ui/icons";

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
      setError("Cannot reach " + trimmed + " — check your internet connection or contact your admin");
    } finally { setTesting(false); }
  }

  return (
    <div className="h-full flex items-center justify-center bg-canvas p-6 overflow-y-auto">
      <div className="bg-surface border border-line rounded-lg shadow-md p-7 w-full max-w-md">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-fg-muted hover:text-fg text-2xs mb-5 inline-flex items-center gap-1.5 transition-colors"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
          Back / رجوع
        </button>

        <h1 className="text-base font-semibold text-fg mb-4">Server Setup / إعداد الخادم</h1>

        <div className="bg-surface-subtle border border-line-subtle rounded-md p-3 mb-5 text-2xs text-fg-secondary space-y-1">
          <p className="font-semibold text-fg">Backend connection:</p>
          <p>All departments connect to the shared cloud backend.</p>
          <p>
            Default: <code className="font-mono bg-surface-active px-1 py-0.5 rounded-sm">https://pure-home-singapore.onrender.com</code>
          </p>
          <p>Click <strong>Test &amp; Save</strong> to verify connectivity. Green = connected.</p>
          <div className="border-t border-line-subtle pt-1.5 mt-1.5" dir="rtl">
            <p className="font-semibold text-fg">إعداد الخادم:</p>
            <p>جميع الأقسام متصلة بالخادم المشترك على الإنترنت.</p>
            <p>لا تحتاج لتغييره إلا بتعليمات من المسؤول.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field
            label="Server URL"
            htmlFor="server-url"
            hint={<>This PC is currently using: <span className="font-mono text-fg-secondary">{serverUrl}</span></>}
          >
            <Input
              id="server-url"
              value={url}
              onChange={e => { setUrl(e.target.value); setStatus("idle"); setError(""); }}
              placeholder="https://pure-home-singapore.onrender.com"
              className="font-mono"
              invalid={status === "error"}
            />
          </Field>

          {status === "ok" && <Callout tone="success">Connected — redirecting...</Callout>}
          {status === "error" && <Callout tone="danger">{error}</Callout>}

          <Button
            variant="primary"
            block
            onClick={handleConnect}
            disabled={!url.trim()}
            loading={testing}
          >
            {testing ? "Testing connection..." : "Test & Save"}
          </Button>

          <Button
            variant="ghost"
            block
            onClick={() => {
              const trimmed = url.trim().replace(/\/$/, "");
              if (!/^https?:\/\/.+/.test(trimmed)) {
                setStatus("error");
                setError("URL must start with http:// or https://");
                return;
              }
              setServerUrl(trimmed);
              navigate("/");
            }}
          >
            Save without testing
          </Button>
        </div>
      </div>
    </div>
  );
}
