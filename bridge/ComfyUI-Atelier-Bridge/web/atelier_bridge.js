import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_ID = "HammelArt.AtelierBridge";

function sanitizeTabName(rawName) {
  const cleaned = String(rawName || "")
    .trim()
    .replace(/\.(png|webp|jpe?g|mp4|webm|mov|json)$/i, "");
  return cleaned || "Atelier Workflow";
}

function showToast(severity, detail) {
  try {
    app.extensionManager?.toast?.add?.({
      severity,
      summary: "HammelArt Atelier",
      detail,
      life: 3200,
    });
  } catch {
    // Non-critical if toast host is unavailable in older frontend builds
  }
}

async function openWorkflowPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  const tabName = sanitizeTabName(payload.name);

  try {
    if (payload.workflow && typeof payload.workflow === "object") {
      await app.loadGraphData(payload.workflow, true, true, tabName, {
        openSource: "atelier",
      });
      showToast("info", `Opened "${tabName}" in a new tab`);
      return;
    }
    if (payload.prompt && typeof payload.prompt === "object") {
      if (typeof app.loadApiJson === "function") {
        await app.loadApiJson(payload.prompt, tabName);
        showToast("info", `Loaded API prompt "${tabName}"`);
      } else {
        showToast("warn", "API prompt cannot be opened visually on this ComfyUI version.");
      }
    }
  } catch (err) {
    console.error("[AtelierBridge] Failed to open workflow:", err);
    showToast("error", `Failed to open "${tabName}"`);
  }
}

async function sendHeartbeat() {
  const clientId = api?.clientId;
  if (!clientId) return;
  try {
    await fetch("/atelier/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
      keepalive: true,
    });
  } catch {
    // Ignore transient network errors when tab is reloading
  }
}

async function consumePendingWorkflow() {
  try {
    const res = await fetch("/atelier/pending", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.pending) {
      await openWorkflowPayload(data.pending);
    }
  } catch {
    // Ignore if bridge endpoint is unavailable
  }
}

app.registerExtension({
  name: EXTENSION_ID,
  async setup() {
    api.addEventListener("atelier.open_workflow", (event) => {
      openWorkflowPayload(event?.detail);
    });

    const onWake = () => {
      sendHeartbeat();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) sendHeartbeat();
    });

    await sendHeartbeat();
    setTimeout(() => {
      sendHeartbeat();
      consumePendingWorkflow();
    }, 180);
  },
});
