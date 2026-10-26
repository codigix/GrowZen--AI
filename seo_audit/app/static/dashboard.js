const form = document.getElementById("audit-form");
const urlInput = document.getElementById("url-input");
const urlLabel = document.getElementById("url-label");
const strategySelect = document.getElementById("strategy-select");
const engineSelect = document.getElementById("engine-select");
const runButton = document.getElementById("run-button");
const formError = document.getElementById("form-error");
const statusBox = document.getElementById("status-box");
const statusText = document.getElementById("status-text");
const resultsPanel = document.getElementById("results-panel");
const historyBody = document.getElementById("history-body");
const modeSingleBtn = document.getElementById("mode-single");
const modeSiteBtn = document.getElementById("mode-site");
const maxPagesControl = document.getElementById("max-pages-control");
const maxPagesInput = document.getElementById("max-pages-input");
const siteHint = document.getElementById("site-hint");
const siteResultsPanel = document.getElementById("site-results-panel");
const sitePagesBody = document.getElementById("site-pages-body");

let currentAuditId = null;
let pollHandle = null;
let sitePollHandle = null;
let mode = "single"; // "single" | "site"

modeSingleBtn.addEventListener("click", () => setMode("single"));
modeSiteBtn.addEventListener("click", () => setMode("site"));

function setMode(next) {
  mode = next;
  modeSingleBtn.classList.toggle("active", mode === "single");
  modeSiteBtn.classList.toggle("active", mode === "site");
  maxPagesControl.hidden = mode !== "site";
  siteHint.hidden = mode !== "site";
  urlLabel.textContent = mode === "site" ? "Website base URL" : "Website URL";
  runButton.textContent = mode === "site" ? "Audit Entire Site" : "Run Audit";
  resultsPanel.hidden = true;
  siteResultsPanel.hidden = true;
  showError("");
}

const METRIC_LABELS = {
  "first-contentful-paint": "First Contentful Paint",
  "largest-contentful-paint": "Largest Contentful Paint",
  "speed-index": "Speed Index",
  "total-blocking-time": "Total Blocking Time",
  "cumulative-layout-shift": "Cumulative Layout Shift",
  "interactive": "Time to Interactive",
  "server-response-time": "Time to First Byte",
  "max-potential-fid": "Max Potential FID",
};

const BUCKET_LABELS = {
  failed: "Failed audits",
  opportunities: "Opportunities",
  diagnostics: "Diagnostics",
  passed: "Passed audits",
  manual: "Manual checks",
  informational: "Informational",
};

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const url = urlInput.value.trim();
  if (!isValidUrl(url)) {
    showError("Please enter a valid http:// or https:// URL.");
    return;
  }

  runButton.disabled = true;
  resultsPanel.hidden = true;
  siteResultsPanel.hidden = true;
  statusBox.hidden = false;
  statusText.textContent = mode === "site" ? "Discovering pages from sitemap..." : "Queued...";

  if (mode === "site") {
    await submitSiteAudit(url);
  } else {
    await submitSingleAudit(url);
  }
});

async function submitSingleAudit(url) {
  try {
    const response = await fetch("/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        strategy: strategySelect.value,
        engine: engineSelect.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to start audit");
    }
    currentAuditId = data.id;
    pollAuditStatus(data.id);
  } catch (err) {
    statusBox.hidden = true;
    runButton.disabled = false;
    showError(err.message);
  }
}

async function submitSiteAudit(url) {
  try {
    const response = await fetch("/api/site-audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        strategy: strategySelect.value,
        engine: engineSelect.value,
        max_pages: Number(maxPagesInput.value) || 10,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to start site audit");
    }
    statusText.textContent = `Auditing ${data.page_count} page(s)...`;
    pollSiteAuditStatus(data.id);
  } catch (err) {
    statusBox.hidden = true;
    runButton.disabled = false;
    showError(err.message);
  }
}

function pollSiteAuditStatus(siteAuditId) {
  clearTimeout(sitePollHandle);

  async function tick() {
    try {
      const response = await fetch(`/api/site-audits/${siteAuditId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Site audit not found");

      if (data.status === "failed" && data.discovery_error) {
        statusBox.hidden = true;
        runButton.disabled = false;
        showError(data.discovery_error);
        return;
      }

      statusText.textContent = `${data.completed_count + data.failed_count}/${data.page_count} page(s) done...`;
      renderSiteAudit(data);

      if (data.status === "completed" || data.status === "failed") {
        statusBox.hidden = true;
        runButton.disabled = false;
        return;
      }
      sitePollHandle = setTimeout(tick, 2500);
    } catch (err) {
      statusBox.hidden = true;
      runButton.disabled = false;
      showError(err.message);
    }
  }
  tick();
}

function renderSiteAudit(data) {
  siteResultsPanel.hidden = false;
  document.getElementById("site-result-url").textContent = data.base_url;
  document.getElementById("site-result-meta-sub").textContent =
    ` · ${data.strategy} · ${data.page_count} page(s) · ${data.completed_count} completed, ${data.failed_count} failed`;

  sitePagesBody.innerHTML = "";
  for (const page of data.pages || []) {
    const row = document.createElement("tr");
    row.className = "history-row";
    const naOr = (v) => (v === null || v === undefined ? "N/A" : Math.round(v));
    row.innerHTML = `
      <td>${escapeHtml(page.submitted_url)}</td>
      <td><span class="status-pill status-${page.status}">${page.status}</span></td>
      <td>${naOr(page.performance_score)}</td>
      <td>${naOr(page.accessibility_score)}</td>
      <td>${naOr(page.best_practices_score)}</td>
      <td>${naOr(page.seo_score)}</td>
      <td>${page.status === "completed" ? "View &rarr;" : (page.error_message ? escapeHtml(page.error_message) : "")}</td>`;
    if (page.status === "completed") {
      row.addEventListener("click", () => {
        resultsPanel.hidden = false;
        window.scrollTo({ top: resultsPanel.offsetTop - 20, behavior: "smooth" });
        loadReport(page.id);
      });
    }
    sitePagesBody.appendChild(row);
  }
}

function pollAuditStatus(auditId) {
  clearTimeout(pollHandle);

  async function tick() {
    try {
      const response = await fetch(`/api/audits/${auditId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Audit not found");

      if (data.status === "queued") {
        statusText.textContent = "Queued, waiting for a worker slot...";
      } else if (data.status === "running") {
        statusText.textContent = "Running Lighthouse audit... this can take up to a few minutes.";
      } else if (data.status === "completed") {
        statusBox.hidden = true;
        runButton.disabled = false;
        await loadReport(auditId);
        loadHistory();
        return;
      } else if (data.status === "failed") {
        statusBox.hidden = true;
        runButton.disabled = false;
        showError(data.error_message || "The audit failed.");
        loadHistory();
        return;
      }
      pollHandle = setTimeout(tick, 2500);
    } catch (err) {
      statusBox.hidden = true;
      runButton.disabled = false;
      showError(err.message);
    }
  }
  tick();
}

function scoreClass(score) {
  if (score === null || score === undefined) return "na";
  if (score >= 90) return "green";
  if (score >= 50) return "orange";
  return "red";
}

function renderScores(scores) {
  const row = document.getElementById("scores-row");
  row.innerHTML = "";
  const labels = [
    ["performance", "Performance"],
    ["accessibility", "Accessibility"],
    ["best_practices", "Best Practices"],
    ["seo", "SEO"],
  ];
  for (const [key, label] of labels) {
    const value = scores[key];
    const display = value === null || value === undefined ? "N/A" : Math.round(value);
    const card = document.createElement("div");
    card.className = "score-card";
    card.innerHTML = `
      <div class="score-circle ${scoreClass(value)}">${display}</div>
      <div class="score-name">${label}</div>`;
    row.appendChild(card);
  }
}

function renderMetrics(metrics) {
  const grid = document.getElementById("metrics-grid");
  grid.innerHTML = "";
  if (!metrics) return;
  for (const [id, metric] of Object.entries(metrics)) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const label = METRIC_LABELS[id] || metric.title || id;
    card.innerHTML = `
      <div class="metric-name">${label}</div>
      <div class="metric-value">${metric.display_value ?? "N/A"}</div>`;
    grid.appendChild(card);
  }
}

function renderFieldData(report) {
  const box = document.getElementById("field-data-box");
  const field = report.field_data;
  if (!field || !field.metrics || Object.keys(field.metrics).length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const entries = Object.entries(field.metrics)
    .map(([id, m]) => `${METRIC_LABELS[id] || id}: ${m.category} (p75 ${m.percentile ?? "N/A"})`)
    .join(" &middot; ");
  box.innerHTML = `<strong>Real-user field data (CrUX)</strong> &mdash; distinct from the lab measurements above. ${entries}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderAuditItem(audit) {
  const savingsParts = [];
  if (audit.savings_ms) savingsParts.push(`${Math.round(audit.savings_ms)} ms potential savings`);
  if (audit.savings_bytes) savingsParts.push(`${Math.round(audit.savings_bytes / 1024)} KB potential savings`);

  return `
    <div class="audit-item">
      <div class="audit-title">
        <span>${escapeHtml(audit.title)}</span>
        ${audit.display_value ? `<span class="badge">${escapeHtml(audit.display_value)}</span>` : ""}
      </div>
      ${audit.description ? `<div class="audit-desc">${escapeHtml(audit.description)}</div>` : ""}
      ${savingsParts.length ? `<div class="audit-savings">${savingsParts.join(" &middot; ")}</div>` : ""}
      ${audit.item_count ? `<div class="audit-desc">${audit.item_count} affected item(s)</div>` : ""}
    </div>`;
}

function renderCategories(report) {
  const container = document.getElementById("categories");
  container.innerHTML = "";
  const categories = report.categories || {};
  const buckets = report.audits_by_category || {};

  for (const [catId, catData] of Object.entries(categories)) {
    const block = document.createElement("div");
    block.className = "category-block";
    const heading = document.createElement("h3");
    heading.textContent = catData.title || catId;
    block.appendChild(heading);

    const catBuckets = buckets[catId] || {};
    const order = ["failed", "opportunities", "diagnostics", "passed", "manual", "informational"];
    for (const bucketKey of order) {
      const items = catBuckets[bucketKey] || [];
      if (items.length === 0) continue;
      const details = document.createElement("details");
      details.className = "audit-group";
      if (bucketKey === "failed" || bucketKey === "opportunities") details.open = true;
      details.innerHTML = `
        <summary>${BUCKET_LABELS[bucketKey]} (${items.length})</summary>
        <div class="group-body">${items.map(renderAuditItem).join("")}</div>`;
      block.appendChild(details);
    }
    container.appendChild(block);
  }
}

async function loadReport(auditId) {
  const response = await fetch(`/api/audits/${auditId}/report`);
  const data = await response.json();
  if (!response.ok) {
    showError(data.detail || "Could not load report");
    return;
  }

  resultsPanel.hidden = false;
  document.getElementById("result-url").textContent = data.final_url || data.submitted_url;
  const engineLabel = (eng) => (eng === "pagespeed" ? "Google PageSpeed Insights" : "Local Lighthouse CLI");
  let metaText = `${data.strategy} · ${engineLabel(data.engine)} · completed ${new Date(data.completed_at).toLocaleString()}`;
  if (data.fallback_reason) {
    metaText += ` · ⚠️ fell back to ${engineLabel(data.engine_used)}: ${data.fallback_reason}`;
  }
  document.getElementById("result-meta-sub").textContent = metaText;

  renderScores(data.scores);
  renderMetrics(data.metrics);
  if (data.report) {
    renderFieldData(data.report);
    renderCategories(data.report);
  }

  document.getElementById("download-json").onclick = () => {
    if (!data.has_raw_json) { alert("Raw JSON report is not available for this audit."); return; }
    window.location.href = `/api/audits/${auditId}/download/json`;
  };
  document.getElementById("download-html").onclick = () => {
    window.location.href = `/api/audits/${auditId}/download/html`;
  };
  document.getElementById("rerun-button").onclick = async () => {
    const res = await fetch(`/api/audits/${auditId}/rerun`, { method: "POST" });
    const payload = await res.json();
    if (res.ok) {
      statusBox.hidden = false;
      statusText.textContent = "Queued...";
      pollAuditStatus(payload.id);
    }
  };
}

function statusPillHtml(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}

async function loadHistory() {
  const response = await fetch("/api/audits/history?page=1&page_size=20");
  const data = await response.json();
  historyBody.innerHTML = "";
  for (const item of data.items) {
    const row = document.createElement("tr");
    row.className = "history-row";
    row.innerHTML = `
      <td>${escapeHtml(item.submitted_url)}</td>
      <td>${item.strategy}</td>
      <td>${item.engine}</td>
      <td>${statusPillHtml(item.status)}</td>
      <td>${item.performance_score ?? "N/A"}</td>
      <td>${item.accessibility_score ?? "N/A"}</td>
      <td>${item.best_practices_score ?? "N/A"}</td>
      <td>${item.seo_score ?? "N/A"}</td>
      <td>${new Date(item.created_at).toLocaleString()}</td>
      <td>${item.status === "completed" ? "Open &rarr;" : ""}</td>`;
    row.addEventListener("click", () => {
      if (item.status === "completed") {
        resultsPanel.hidden = false;
        window.scrollTo({ top: resultsPanel.offsetTop - 20, behavior: "smooth" });
        loadReport(item.id);
      }
    });
    historyBody.appendChild(row);
  }
}

loadHistory();
