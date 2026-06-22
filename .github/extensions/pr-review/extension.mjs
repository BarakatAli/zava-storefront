// Extension: pr-review
// Reads a PR diff + team guidelines and renders a structured review panel
// (verdict → reason → findings ordered by criticality, per dimension).

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
// Navigate from .github/extensions/pr-review/ up to the repo root
const repoRoot = resolve(dirname(__filename), "../../..");

// Cap diff sent to the model to keep prompt size reasonable.
// The extension notes truncation so the reviewer knows coverage is partial.
const DIFF_CHAR_LIMIT = 60_000;

// Severity ordering (lower index = more critical)
const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

// --- State stores (ephemeral per process) ---

// prNumber (string) → { pr, report }
const cachedReports = new Map();

// instanceId → { server, url, sseClients: Set<res> }
const servers = new Map();

// instanceId → { prNumber, status: 'loading' | 'done' | 'error', error? }
const instanceMeta = new Map();

// --- SSE helpers ---

function pushSse(instanceId, payload) {
    const entry = servers.get(instanceId);
    if (!entry) return;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of entry.sseClients) {
        try { res.write(line); } catch (_) { /* client gone */ }
    }
}

// --- Analysis pipeline ---

async function runAnalysis(prNumber, instanceId) {
    const pn = String(prNumber);
    try {
        await session.log(`PR Review #${pn}: fetching metadata…`, { ephemeral: true });

        const { stdout: prJson } = await execFileAsync(
            "gh",
            ["pr", "view", pn, "--json", "title,author,additions,deletions,changedFiles,body,url,headRefName"],
            { cwd: repoRoot },
        );
        const pr = JSON.parse(prJson);

        await session.log(`PR Review #${pn}: fetching diff…`, { ephemeral: true });
        const { stdout: rawDiff } = await execFileAsync(
            "gh",
            ["pr", "diff", pn],
            { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
        );
        const truncated = rawDiff.length > DIFF_CHAR_LIMIT;
        const diff = truncated
            ? rawDiff.slice(0, DIFF_CHAR_LIMIT) +
              `\n\n[DIFF TRUNCATED — showing first 60 KB of ${Math.round(rawDiff.length / 1024)} KB total]`
            : rawDiff;

        const [secGuide, archGuide, docGuide] = await Promise.all([
            readFile(resolve(repoRoot, "guidelines/security.md"), "utf8").catch(() => "(guidelines/security.md not found)"),
            readFile(resolve(repoRoot, "guidelines/architecture.md"), "utf8").catch(() => "(guidelines/architecture.md not found)"),
            readFile(resolve(repoRoot, "guidelines/documentation.md"), "utf8").catch(() => "(guidelines/documentation.md not found)"),
        ]);

        await session.log(`PR Review #${pn}: analysing against guidelines…`, { ephemeral: true });

        const analysisPrompt = `You are a senior code reviewer. Analyse the pull-request diff below against the three team guideline files provided.

Return ONLY a raw JSON object — no markdown fences, no preamble, no explanation. The shape must be:
{
  "verdict": "MERGE" | "REQUEST_CHANGES",
  "reason": "<1–3 sentences explaining the overall verdict>",
  "findings": [
    {
      "dimension": "security" | "architecture" | "documentation",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "<short finding title>",
      "detail": "<specific detail and location in the diff>"
    }
  ]
}

Rules:
- findings must be ordered by severity (critical first, then high, medium, low, info).
- Every dimension must appear at least once. If a dimension is clean, add one entry with severity "info" and title "No issues found".
- verdict is REQUEST_CHANGES if ANY finding is critical or high; MERGE otherwise.

## PR: ${pr.title} (#${pn})
Branch: ${pr.headRefName ?? "unknown"} | Author: ${pr.author?.login ?? "unknown"}
Files changed: ${pr.changedFiles} | +${pr.additions} -${pr.deletions}

## PR Description
${pr.body?.trim() || "(no description)"}

## SECURITY GUIDELINES
${secGuide}

## ARCHITECTURE GUIDELINES
${archGuide}

## DOCUMENTATION GUIDELINES
${docGuide}

## DIFF${truncated ? " [TRUNCATED — partial coverage]" : ""}
${diff}`;

        const response = await session.sendAndWait({ prompt: analysisPrompt });
        const content = response?.data?.content ?? "";

        // Strip markdown fences if the model wrapped the JSON
        const stripped = content
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/, "")
            .trim();

        let report;
        try {
            report = JSON.parse(stripped);
            // Ensure findings are sorted by severity
            report.findings?.sort(
                (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
            );
        } catch (_) {
            // Try extracting first {...} block as fallback
            const match = content.match(/\{[\s\S]*\}/);
            try {
                report = match ? JSON.parse(match[0]) : null;
            } catch (_2) { report = null; }
        }

        if (!report) {
            report = {
                verdict: "REQUEST_CHANGES",
                reason: "Analysis failed — could not parse a structured report from the model's response.",
                findings: [{ dimension: "security", severity: "info", title: "Parse error", detail: content.slice(0, 500) }],
            };
        }

        cachedReports.set(pn, { pr, report, truncated });
        const meta = instanceMeta.get(instanceId);
        if (meta) meta.status = "done";
        pushSse(instanceId, { type: "report", pr, report, truncated });
        await session.log(`PR Review #${pn}: done — ${report.verdict}`, { ephemeral: true });

    } catch (err) {
        const meta = instanceMeta.get(instanceId);
        if (meta) { meta.status = "error"; meta.error = String(err); }
        pushSse(instanceId, { type: "error", message: String(err) });
        await session.log(`PR Review #${pn}: error — ${err}`, { level: "error", ephemeral: true });
    }
}

// --- HTML renderer ---

function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PR Review</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: var(--text-body-medium, 14px);
    line-height: var(--leading-body-medium, 20px);
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
    padding: 16px;
  }
  header { margin-bottom: 12px; }
  h1 { font-size: var(--text-title-large, 20px); font-weight: var(--font-weight-semibold, 600); }
  .meta { color: var(--text-color-muted, #656d76); font-size: 12px; margin-top: 4px; }
  .verdict {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 20px;
    font-weight: var(--font-weight-semibold, 600);
    font-size: 13px; margin: 12px 0 8px;
  }
  .verdict.merge  { background: #d1fae5; color: #065f46; }
  .verdict.request { background: #fee2e2; color: #991b1b; }
  .reason { color: var(--text-color-muted, #656d76); margin-bottom: 16px; font-size: 13px; }
  h2 { font-size: 13px; font-weight: var(--font-weight-semibold, 600); text-transform: uppercase;
       letter-spacing: .05em; color: var(--text-color-muted, #656d76); margin: 16px 0 6px; }
  .finding {
    border: 1px solid var(--border-color-default, #d0d7de);
    border-radius: 6px; padding: 8px 12px; margin-bottom: 6px;
    display: flex; gap: 10px; align-items: flex-start;
  }
  .sev-badge {
    font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px;
    white-space: nowrap; flex-shrink: 0; margin-top: 1px;
  }
  .sev-critical { background:#fee2e2; color:#991b1b; }
  .sev-high     { background:#ffedd5; color:#9a3412; }
  .sev-medium   { background:#fef9c3; color:#854d0e; }
  .sev-low      { background:#e0f2fe; color:#075985; }
  .sev-info     { background:#f3f4f6; color:#4b5563; }
  .finding-body .title { font-weight: var(--font-weight-semibold, 600); font-size: 13px; }
  .finding-body .detail { color: var(--text-color-muted, #656d76); font-size: 12px; margin-top: 2px; }
  .truncation-note {
    background: #fef9c3; color: #854d0e; border: 1px solid #fde047;
    border-radius: 6px; padding: 6px 10px; font-size: 12px; margin-bottom: 12px;
  }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button {
    padding: 5px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: 1px solid var(--border-color-default, #d0d7de);
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
  }
  button:hover { background: var(--background-color-overlay, #f6f8fa); }
  .loading { color: var(--text-color-muted, #656d76); display: flex; align-items: center; gap: 8px; padding: 24px 0; }
  .spinner {
    width: 16px; height: 16px; border: 2px solid var(--border-color-default, #d0d7de);
    border-top-color: var(--text-color-default, #1f2328);
    border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dim-sec { border-left: 3px solid var(--true-color-red, #cf222e); }
  .dim-arch { border-left: 3px solid var(--true-color-blue, #0969da); }
  .dim-doc  { border-left: 3px solid #7c3aed; }
</style>
</head>
<body>
<div id="root"><div class="loading"><div class="spinner"></div>Analysing PR…</div></div>
<script>
const root = document.getElementById('root');
const SEV_LABELS = { critical:'CRITICAL', high:'HIGH', medium:'MEDIUM', low:'LOW', info:'INFO' };
const DIM_EMOJI = { security:'🔴', architecture:'🟡', documentation:'🟢' };

function dimClass(d) { return d === 'security' ? 'dim-sec' : d === 'architecture' ? 'dim-arch' : 'dim-doc'; }

function render({ pr, report, truncated }) {
  const isRC = report.verdict === 'REQUEST_CHANGES';
  const vClass = isRC ? 'request' : 'merge';
  const vLabel = isRC ? '⛔ Request Changes' : '✅ Merge';

  const dims = ['security','architecture','documentation'];
  const grouped = Object.fromEntries(dims.map(d => [d, (report.findings || []).filter(f => f.dimension === d)]));

  const findingHtml = (f) => \`
    <div class="finding \${dimClass(f.dimension)}">
      <span class="sev-badge sev-\${f.severity}">\${SEV_LABELS[f.severity] || f.severity.toUpperCase()}</span>
      <div class="finding-body">
        <div class="title">\${esc(f.title)}</div>
        <div class="detail">\${esc(f.detail)}</div>
      </div>
    </div>\`;

  const dimSection = (d) => \`
    <h2>\${DIM_EMOJI[d] || ''} \${d.charAt(0).toUpperCase()+d.slice(1)}</h2>
    \${(grouped[d] || []).map(findingHtml).join('') || '<p style="color:var(--text-color-muted,#656d76);font-size:13px">No findings.</p>'}
  \`;

  root.innerHTML = \`
    <header>
      <h1>\${esc(pr.title)}</h1>
      <div class="meta">\${esc(pr.author?.login || 'unknown')} · +\${pr.additions} −\${pr.deletions} · \${pr.changedFiles} file(s)</div>
    </header>
    \${truncated ? '<div class="truncation-note">⚠ Diff was truncated to 60 KB — large files may have reduced coverage.</div>' : ''}
    <div class="verdict \${vClass}">\${vLabel}</div>
    <p class="reason">\${esc(report.reason)}</p>
    \${dims.map(dimSection).join('')}
    <div class="actions">
      <button onclick="doRefresh()">↺ Refresh</button>
      <button onclick="doCopy()">⎘ Copy JSON</button>
    </div>
  \`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function doRefresh() {
  root.innerHTML = '<div class="loading"><div class="spinner"></div>Re-analysing…</div>';
  fetch('/refresh', { method: 'POST' });
}

function doCopy() {
  fetch('/state').then(r => r.json()).then(d => {
    if (d.report) navigator.clipboard.writeText(JSON.stringify(d, null, 2));
  });
}

// Bootstrap: try cached state first, then open SSE
fetch('/state').then(r => r.json()).then(d => {
  if (d.status === 'done' && d.report) render(d);
  else if (d.status === 'error') root.innerHTML = '<p style="color:red;padding:24px 0">' + esc(d.error) + '</p>';
});

const es = new EventSource('/events');
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'report') render(msg);
  else if (msg.type === 'error') root.innerHTML = '<p style="color:red;padding:24px 0">' + esc(msg.message) + '</p>';
  else if (msg.type === 'loading') root.innerHTML = '<div class="loading"><div class="spinner"></div>Re-analysing…</div>';
};
<\/script>
</body>
</html>`;
}

// --- HTTP server factory ---

async function startServer(instanceId) {
    const sseClients = new Set();

    const server = createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");

        if (url.pathname === "/events") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            });
            res.write(":\n\n"); // comment to open the connection
            sseClients.add(res);
            req.on("close", () => sseClients.delete(res));
            return;
        }

        if (url.pathname === "/state" && req.method === "GET") {
            const meta = instanceMeta.get(instanceId);
            const pn = meta?.prNumber;
            const cached = pn ? cachedReports.get(pn) : null;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(cached
                ? { status: "done", ...cached }
                : { status: meta?.status ?? "loading", error: meta?.error }
            ));
            return;
        }

        if (url.pathname === "/refresh" && req.method === "POST") {
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            const meta = instanceMeta.get(instanceId);
            if (meta) {
                meta.status = "loading";
                // Notify iframe immediately
                const line = `data: ${JSON.stringify({ type: "loading" })}\n\n`;
                for (const c of sseClients) { try { c.write(line); } catch (_) {} }
                runAnalysis(meta.prNumber, instanceId);
            }
            return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHtml());
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, sseClients };
}

// --- Extension wiring ---

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "pr-review",
            displayName: "PR Review",
            description: "Reviews a PR against team security, architecture, and documentation guidelines. Opens a structured panel: verdict → reason → findings by criticality.",
            inputSchema: {
                type: "object",
                properties: {
                    prNumber: {
                        oneOf: [{ type: "string" }, { type: "number" }],
                        description: "The PR number to review, e.g. 3 or \"3\".",
                    },
                },
                required: ["prNumber"],
            },
            actions: [
                {
                    name: "refresh",
                    description: "Re-fetch the PR diff and re-run the analysis against the guidelines.",
                    handler: async (ctx) => {
                        const meta = instanceMeta.get(ctx.instanceId);
                        if (!meta) throw new CanvasError("not_open", "Canvas instance not found.");
                        meta.status = "loading";
                        pushSse(ctx.instanceId, { type: "loading" });
                        runAnalysis(meta.prNumber, ctx.instanceId); // fire-and-forget
                        return { ok: true, message: "Re-analysis started." };
                    },
                },
                {
                    name: "get-report",
                    description: "Returns the structured review report as JSON (verdict, reason, findings). Use after the canvas is open and analysis has completed.",
                    handler: async (ctx) => {
                        const meta = instanceMeta.get(ctx.instanceId);
                        if (!meta) throw new CanvasError("not_open", "Canvas instance not found.");
                        const cached = cachedReports.get(String(meta.prNumber));
                        if (!cached) throw new CanvasError("not_ready", "Analysis not yet complete.");
                        return cached;
                    },
                },
            ],
            open: async (ctx) => {
                const prNumber = String(ctx.input?.prNumber ?? "");
                if (!prNumber) throw new CanvasError("missing_input", "prNumber is required.");

                // Reuse existing server for same instanceId (idempotent re-open)
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }

                instanceMeta.set(ctx.instanceId, { prNumber, status: "loading" });

                // If we already have a cached report for this PR, push it immediately
                const cached = cachedReports.get(prNumber);
                if (cached) {
                    instanceMeta.get(ctx.instanceId).status = "done";
                    // Push after a tick so the iframe SSE subscription is set up
                    setTimeout(() => pushSse(ctx.instanceId, { type: "report", ...cached }), 200);
                } else {
                    // Background analysis — open() returns before it finishes
                    runAnalysis(prNumber, ctx.instanceId);
                }

                return {
                    title: `PR Review #${prNumber}`,
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    instanceMeta.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
