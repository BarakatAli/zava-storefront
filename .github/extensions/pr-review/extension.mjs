// Extension: pr-review
// Agent-driven PR review canvas. The agent fetches the diff + guidelines,
// analyses them, then calls submit-review with the structured JSON. The canvas
// is a pure renderer â€” no sendAndWait, no timeouts.
//
// Agent workflow:
//   1. open_canvas({ canvasId:"pr-review", instanceId:"pr-review-N", input:{prNumber:N} })
//   2. Fetch diff:   gh pr diff N
//   3. Fetch meta:   gh pr view N --json title,author,additions,deletions,changedFiles,body,headRefName
//   4. Read guidelines: guidelines/security.md, architecture.md, documentation.md
//   5. Analyse (agent's own reasoning â€” no extra tool call needed)
//   6. invoke_canvas_action({ instanceId, actionName:"submit-review", input:{ pr, report, truncated? } })

import { createServer } from "node:http";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

// Severity ordering (lower index = more critical)
const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

// --- State stores ---
// prNumber (string) â†’ { pr, report, truncated }
const cachedReports = new Map();
// instanceId â†’ { server, url, sseClients: Set<res>, prNumber }
const servers = new Map();

// --- SSE helpers ---
function pushSse(instanceId, payload) {
    const entry = servers.get(instanceId);
    if (!entry) return;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of entry.sseClients) {
        try { res.write(line); } catch (_) {}
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
  h1 { font-size: var(--text-title-large, 20px); font-weight: var(--font-weight-semibold, 600); }
  .meta { color: var(--text-color-muted, #656d76); font-size: 12px; margin-top: 4px; }
  .verdict {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 20px;
    font-weight: var(--font-weight-semibold, 600); font-size: 13px; margin: 12px 0 8px;
  }
  .verdict.merge   { background: #d1fae5; color: #065f46; }
  .verdict.request { background: #fee2e2; color: #991b1b; }
  .reason { color: var(--text-color-muted, #656d76); margin-bottom: 16px; font-size: 13px; }
  h2 { font-size: 13px; font-weight: var(--font-weight-semibold, 600); text-transform: uppercase;
       letter-spacing: .05em; color: var(--text-color-muted, #656d76); margin: 16px 0 6px; }
  .finding {
    border: 1px solid var(--border-color-default, #d0d7de);
    border-radius: 6px; padding: 8px 12px; margin-bottom: 6px;
    display: flex; gap: 10px; align-items: flex-start;
  }
  .sev-badge { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
  .sev-critical { background:#fee2e2; color:#991b1b; }
  .sev-high     { background:#ffedd5; color:#9a3412; }
  .sev-medium   { background:#fef9c3; color:#854d0e; }
  .sev-low      { background:#e0f2fe; color:#075985; }
  .sev-info     { background:#f3f4f6; color:#4b5563; }
  .finding-body .title  { font-weight: var(--font-weight-semibold, 600); font-size: 13px; }
  .finding-body .detail { color: var(--text-color-muted, #656d76); font-size: 12px; margin-top: 2px; }
  .truncation-note { background: #fef9c3; color: #854d0e; border: 1px solid #fde047;
    border-radius: 6px; padding: 6px 10px; font-size: 12px; margin-bottom: 12px; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { padding: 5px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: 1px solid var(--border-color-default, #d0d7de);
    background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); }
  button:hover { background: var(--background-color-overlay, #f6f8fa); }
  .loading { color: var(--text-color-muted, #656d76); display: flex; align-items: center; gap: 8px; padding: 24px 0; }
  .spinner { width: 16px; height: 16px; border: 2px solid var(--border-color-default, #d0d7de);
    border-top-color: var(--text-color-default, #1f2328); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dim-sec  { border-left: 3px solid var(--true-color-red, #cf222e); }
  .dim-arch { border-left: 3px solid var(--true-color-blue, #0969da); }
  .dim-doc  { border-left: 3px solid #7c3aed; }
</style>
</head>
<body>
<div id="root"><div class="loading"><div class="spinner"></div>Waiting for analysisâ€¦</div></div>
<script>
const root = document.getElementById('root');
const SEV_LABELS = { critical:'CRITICAL', high:'HIGH', medium:'MEDIUM', low:'LOW', info:'INFO' };
const DIM_EMOJI  = { security:'ðŸ”´', architecture:'ðŸŸ¡', documentation:'ðŸŸ¢' };

function dimClass(d) { return d === 'security' ? 'dim-sec' : d === 'architecture' ? 'dim-arch' : 'dim-doc'; }

function render({ pr, report, truncated }) {
  const isRC = report.verdict === 'REQUEST_CHANGES';
  const dims = ['security','architecture','documentation'];
  const grouped = Object.fromEntries(dims.map(d => [d, (report.findings||[]).filter(f=>f.dimension===d)]));

  const findingHtml = f => \`
    <div class="finding \${dimClass(f.dimension)}">
      <span class="sev-badge sev-\${f.severity}">\${SEV_LABELS[f.severity]||f.severity.toUpperCase()}</span>
      <div class="finding-body">
        <div class="title">\${esc(f.title)}</div>
        <div class="detail">\${esc(f.detail)}</div>
      </div>
    </div>\`;

  root.innerHTML = \`
    <header style="margin-bottom:12px">
      <h1>\${esc(pr.title)}</h1>
      <div class="meta">\${esc(pr.author?.login||'unknown')} Â· +\${pr.additions} âˆ’\${pr.deletions} Â· \${pr.changedFiles} file(s)</div>
    </header>
    \${truncated ? '<div class="truncation-note">âš  Diff was truncated â€” large files may have reduced coverage.</div>' : ''}
    <div class="verdict \${isRC?'request':'merge'}">\${isRC?'â›” Request Changes':'âœ… Merge'}</div>
    <p class="reason">\${esc(report.reason)}</p>
    \${dims.map(d=>\`
      <h2>\${DIM_EMOJI[d]||''} \${d.charAt(0).toUpperCase()+d.slice(1)}</h2>
      \${(grouped[d]||[]).map(findingHtml).join('')||'<p style="color:var(--text-color-muted,#656d76);font-size:13px">No findings.</p>'}
    \`).join('')}
    <div class="actions">
      <button onclick="doCopy()">âŽ˜ Copy JSON</button>
    </div>\`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function doCopy() {
  fetch('/state').then(r=>r.json()).then(d=>{
    if (d.report) navigator.clipboard.writeText(JSON.stringify(d, null, 2));
  });
}

// Bootstrap â€” try cached state first
fetch('/state').then(r=>r.json()).then(d=>{
  if (d.status==='done' && d.report) render(d);
});

// SSE for live updates pushed by submit-review action
const es = new EventSource('/events');
es.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.type==='report') render(msg);
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
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
            res.write(":\n\n");
            sseClients.add(res);
            req.on("close", () => sseClients.delete(res));
            return;
        }

        if (url.pathname === "/state") {
            const entry = servers.get(instanceId);
            const cached = entry?.prNumber ? cachedReports.get(entry.prNumber) : null;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(cached ? { status: "done", ...cached } : { status: "loading" }));
            return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHtml());
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, sseClients };
}

// --- Extension wiring ---
const session = await joinSession({
    canvases: [
        createCanvas({
            id: "pr-review",
            displayName: "PR Review",
            description: "Reviews a PR against team security, architecture, and documentation guidelines. Opens a structured panel: verdict â†’ reason â†’ findings by criticality, per dimension.",
            inputSchema: {
                type: "object",
                properties: {
                    prNumber: {
                        oneOf: [{ type: "string" }, { type: "number" }],
                        description: "PR number to review.",
                    },
                },
                required: ["prNumber"],
            },
            actions: [
                {
                    name: "submit-review",
                    description: "Push a completed review report into the canvas panel. Call this after you have analysed the PR diff against the guidelines.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            pr: {
                                type: "object",
                                description: "PR metadata: { title, author: { login }, additions, deletions, changedFiles }",
                            },
                            report: {
                                type: "object",
                                description: "Structured review report: { verdict: 'MERGE'|'REQUEST_CHANGES', reason: string, findings: Array<{ dimension, severity, title, detail }> }",
                            },
                            truncated: {
                                type: "boolean",
                                description: "Set true if the diff was truncated before analysis.",
                            },
                        },
                        required: ["pr", "report"],
                    },
                    handler: async (ctx) => {
                        const { pr, report, truncated } = ctx.input;
                        if (!report?.verdict || !Array.isArray(report?.findings)) {
                            throw new CanvasError("invalid_report", "report must have verdict and findings[].");
                        }
                        // Sort findings by severity
                        report.findings.sort((a, b) =>
                            SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
                        );
                        const entry = servers.get(ctx.instanceId);
                        const prNumber = entry?.prNumber ?? "unknown";
                        cachedReports.set(prNumber, { pr, report, truncated: !!truncated });
                        pushSse(ctx.instanceId, { type: "report", pr, report, truncated: !!truncated });
                        await session.log(`PR Review #${prNumber}: rendered â€” ${report.verdict}`, { ephemeral: true });
                        return { ok: true, verdict: report.verdict };
                    },
                },
                {
                    name: "get-report",
                    description: "Returns the cached review report as JSON. Use to cite findings in chat.",
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        const cached = entry?.prNumber ? cachedReports.get(entry.prNumber) : null;
                        if (!cached) throw new CanvasError("not_ready", "No report yet â€” call submit-review first.");
                        return cached;
                    },
                },
            ],
            open: async (ctx) => {
                const prNumber = String(ctx.input?.prNumber ?? "");
                if (!prNumber) throw new CanvasError("missing_input", "prNumber is required.");

                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                entry.prNumber = prNumber;

                // If a cached report exists, push it after a tick (iframe SSE time to subscribe)
                const cached = cachedReports.get(prNumber);
                if (cached) {
                    setTimeout(() => pushSse(ctx.instanceId, { type: "report", ...cached }), 300);
                }

                return { title: `PR Review #${prNumber}`, url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise(r => entry.server.close(() => r()));
                }
            },
        }),
    ],
});
