frappe.pages["recovery-wizard"].on_page_load = function (wrapper) {
const page = frappe.ui.make_app_page({
parent: wrapper,
title: "Recovery Wizard",
single_column: true,
});

$(wrapper).find(".page-content").append('<div id="rw-root"></div>');
const wizard = new RecoveryWizard(wrapper, page);
wrapper._wizard = wizard;
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const STYLES = `
#rw-root { padding: 16px 0 40px; font-family: var(--font-stack); }
.rw-subtitle { color: var(--text-muted); font-size: var(--text-sm); margin-top:-8px; margin-bottom:24px; }
.rw-step { display: none; }
.rw-step.active { display: block; }
.rw-card {
background: var(--card-bg); border: 1px solid var(--border-color);
border-radius: var(--border-radius-lg); padding: 24px; margin-bottom: 16px;
}
.rw-section-title { font-size:15px; font-weight:600; color:var(--heading-color); margin:20px 0 10px; }
.rw-info-box {
background: var(--bg-light-gray, #f9fafb); border:1px solid var(--border-color);
border-radius: var(--border-radius); padding:12px 16px; margin-bottom:16px;
font-size:13px; color:var(--text-muted);
}
.rw-warn-box {
background: #fffbeb; border:1px solid #fcd34d;
border-radius: var(--border-radius); padding:12px 16px; margin-bottom:16px;
font-size:13px; color:#92400e;
}
.rw-summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
@media(max-width:640px){ .rw-summary-grid{ grid-template-columns:repeat(2,1fr); } }
.rw-stat-card {
background:var(--card-bg); border:1px solid var(--border-color);
border-radius:var(--border-radius-lg); padding:16px; text-align:center;
}
.rw-stat-num { font-size:28px; font-weight:700; color:var(--heading-color); }
.rw-stat-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); margin-top:4px; }
.rw-table { width:100%; border-collapse:collapse; font-size:13px; }
.rw-table th { padding:8px 10px; background:var(--bg-light-gray,#f9fafb); text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); border-bottom:1px solid var(--border-color); }
.rw-table td { padding:8px 10px; border-bottom:1px solid var(--border-color); vertical-align:middle; }
.rw-table tr:last-child td { border-bottom:none; }
.rw-table tr.exists-row td { opacity:.55; }
.rw-badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:600; }
.rw-badge-green { background:#d1fae5; color:#065f46; }
.rw-badge-blue  { background:#dbeafe; color:#1e40af; }
.rw-badge-gray  { background:#f3f4f6; color:#6b7280; }
.rw-badge-orange{ background:#ffedd5; color:#9a3412; }
.rw-actions { display:flex; gap:10px; margin-top:20px; }
.rw-error-item { color:var(--red-500,#ef4444); font-size:12px; margin-top:4px; }
.rw-created-link { display:block; padding:4px 0; font-size:13px; }
.rw-loading { text-align:center; padding:60px; color:var(--text-muted); font-size:13px; }
.rw-select-all-row { display:flex; gap:16px; align-items:center; margin-bottom:8px; font-size:12px; color:var(--text-muted); }
.rw-select-all-row a { cursor:pointer; }
`;

// ─── Wizard class ─────────────────────────────────────────────────────────────
class RecoveryWizard {
constructor(wrapper, page) {
this.wrapper = wrapper;
this.$root = $(wrapper).find("#rw-root");
this.page = page;
this.scanData = null;
this._inject_styles();
this._render_step1();
}

_inject_styles() {
if (!document.getElementById("rw-styles")) {
const el = document.createElement("style");
el.id = "rw-styles";
el.textContent = STYLES;
document.head.appendChild(el);
}
}

// ── Step 1: Scan ──────────────────────────────────────────────────────────
_render_step1() {
this.$root.html(`
<p class="rw-subtitle">Scan all servers to discover running sites and custom images, then selectively restore records.</p>
<div class="rw-step active" id="rw-step1">
<div class="rw-card">
<div class="rw-section-title">Before You Begin</div>
<div class="rw-info-box">
This wizard scans all registered servers for running Docker Compose stacks and
locally-built images. It reads <code>.env</code> files to recover site configuration.
<br><br>
<strong>What can be recovered automatically:</strong> site URLs, bench names,
database credentials, admin passwords, Docker images, installed app list.
<br><br>
<strong>What must be re-entered manually:</strong> Apps catalog entries (repo URLs,
PAT tokens, branches) and customer / billing assignments.
</div>
<div class="rw-warn-box">
⚠️ This wizard creates records in <strong>Draft/Active</strong> state without full
validation. Review every imported record before activating billing.
</div>
<div class="rw-actions">
<button class="btn btn-primary" id="rw-scan-btn">
Scan All Servers
</button>
</div>
</div>
</div>

<div class="rw-step" id="rw-step2"></div>
<div class="rw-step" id="rw-step3"></div>
`);

this.$root.find("#rw-scan-btn").on("click", () => this._do_scan());
}

// ── Scan action ───────────────────────────────────────────────────────────
async _do_scan() {
const $btn = this.$root.find("#rw-scan-btn");
$btn.prop("disabled", true).text("Scanning…");
this.$root.find("#rw-step1 .rw-card").append(
'<div class="rw-loading" id="rw-scan-progress">Connecting to servers and scanning Docker state…<br><small>This may take 30–60 seconds per server.</small></div>'
);

try {
const r = await frappe.call({
method: "nano_press.nano_press.page.recovery_wizard.recovery_wizard.scan_all_servers",
freeze: false,
});
this.scanData = r.message;
this._render_step2();
} catch (e) {
frappe.msgprint({ title: "Scan Failed", message: String(e), indicator: "red" });
$btn.prop("disabled", false).text("Retry Scan");
this.$root.find("#rw-scan-progress").remove();
}
}

// ── Step 2: Review ────────────────────────────────────────────────────────
_render_step2() {
const d = this.scanData;
const newImages = d.images.filter(i => !i.exists);
const newSites  = d.sites.filter(s => !s.exists);

this.$root.find("#rw-step1").removeClass("active");

const $step2 = this.$root.find("#rw-step2").addClass("active");
$step2.html(`
<div class="rw-summary-grid">
${this._stat(d.server_count, "Servers Scanned")}
${this._stat(d.images.length, "Images Found")}
${this._stat(d.sites.length, "Sites Found")}
${this._stat(d.errors.length, "Scan Errors", d.errors.length > 0 ? "rw-stat-num np-red" : "")}
</div>

${d.errors.length ? `
<div class="rw-warn-box">
<strong>Scan errors on some servers:</strong>
${d.errors.map(e => `<div class="rw-error-item">• ${frappe.utils.escape_html(e.server)}: ${frappe.utils.escape_html(e.error)}</div>`).join("")}
</div>` : ""}

<div class="rw-section-title">Custom Images</div>
${d.images.length === 0
? '<div class="rw-info-box">No custom images found on any server.</div>'
: this._images_table(d.images)
}

<div class="rw-section-title" style="margin-top:24px">Frappe Sites</div>
${d.sites.length === 0
? '<div class="rw-info-box">No running sites found on any server.</div>'
: this._sites_table(d.sites)
}

<div class="rw-warn-box" style="margin-top:16px">
ℹ️ Rows highlighted in gray already exist in the database and are pre-deselected.
Apps catalog entries (repo URLs, tokens) must be re-entered manually after import.
</div>

<div class="rw-actions">
<button class="btn btn-primary" id="rw-import-btn">Import Selected</button>
<button class="btn btn-default" id="rw-back-btn">Back</button>
<span id="rw-selection-info" style="line-height:32px; font-size:13px; color:var(--text-muted); margin-left:8px;"></span>
</div>
`);

this._update_selection_info();

$step2.find("#rw-import-btn").on("click", () => this._do_import());
$step2.find("#rw-back-btn").on("click", () => {
$step2.removeClass("active");
this.$root.find("#rw-step1").addClass("active");
this.$root.find("#rw-scan-btn").prop("disabled", false).text("Scan All Servers");
this.$root.find("#rw-scan-progress").remove();
});

$step2.find(".rw-select-all").on("click", function () {
const group = $(this).data("group");
$step2.find(`input.rw-chk[data-group="${group}"]`).prop("checked", true);
});
$step2.find(".rw-deselect-all").on("click", function () {
const group = $(this).data("group");
$step2.find(`input.rw-chk[data-group="${group}"]`).prop("checked", false);
});
$step2.find(".rw-chk").on("change", () => this._update_selection_info());
}

_stat(val, label, numClass = "rw-stat-num") {
return `
<div class="rw-stat-card">
<div class="${numClass}">${val}</div>
<div class="rw-stat-label">${label}</div>
</div>`;
}

_images_table(images) {
const rows = images.map((img, idx) => {
const cls = img.exists ? "exists-row" : "";
const badge = img.exists
? '<span class="rw-badge rw-badge-gray">Exists</span>'
: '<span class="rw-badge rw-badge-green">New</span>';
return `
<tr class="${cls}" data-idx="${idx}">
<td><input type="checkbox" class="rw-chk" data-group="images" data-idx="${idx}" ${img.exists ? "" : "checked"}></td>
<td>${frappe.utils.escape_html(img.server || "")}</td>
<td style="font-family:monospace;font-size:12px">${frappe.utils.escape_html(img.repo || "")}</td>
<td style="font-family:monospace;font-size:12px">${frappe.utils.escape_html(img.tag || "")}</td>
<td>${frappe.utils.escape_html(img.size || "")}</td>
<td>${frappe.utils.escape_html(img.created || "")}</td>
<td>${badge}</td>
</tr>`;
}).join("");

return `
<div class="rw-select-all-row">
<a class="rw-select-all" data-group="images">Select all</a>
<a class="rw-deselect-all" data-group="images">Deselect all</a>
</div>
<div style="overflow-x:auto">
<table class="rw-table">
<thead><tr>
<th></th><th>Server</th><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th><th>Status</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`;
}

_sites_table(sites) {
const rows = sites.map((site, idx) => {
const cls = site.exists ? "exists-row" : "";
const badge = site.exists
? '<span class="rw-badge rw-badge-gray">Exists</span>'
: '<span class="rw-badge rw-badge-blue">New</span>';
const stackBadge = (site.stack_status || "").toLowerCase().includes("running")
? '<span class="rw-badge rw-badge-green">Running</span>'
: `<span class="rw-badge rw-badge-orange">${frappe.utils.escape_html(site.stack_status||"Unknown")}</span>`;
const apps = site.install_apps
? site.install_apps.split(",").map(a => `<code>${frappe.utils.escape_html(a.trim())}</code>`).join(" ")
: "<span style='color:var(--text-muted)'>frappe only</span>";
return `
<tr class="${cls}" data-idx="${idx}">
<td><input type="checkbox" class="rw-chk" data-group="sites" data-idx="${idx}" ${site.exists ? "" : "checked"}></td>
<td>${frappe.utils.escape_html(site.server || "")}</td>
<td>${frappe.utils.escape_html(site.bench_name || "")}</td>
<td>${frappe.utils.escape_html(site.site_url || "")}</td>
<td style="font-family:monospace;font-size:11px">${frappe.utils.escape_html(site.docker_image || "")}</td>
<td>${apps}</td>
<td>${stackBadge}</td>
<td>${badge}</td>
</tr>`;
}).join("");

return `
<div class="rw-select-all-row">
<a class="rw-select-all" data-group="sites">Select all</a>
<a class="rw-deselect-all" data-group="sites">Deselect all</a>
</div>
<div style="overflow-x:auto">
<table class="rw-table">
<thead><tr>
<th></th><th>Server</th><th>Bench Name</th><th>Site URL</th><th>Image</th><th>Apps</th><th>Stack</th><th>Status</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`;
}

_update_selection_info() {
const imgSel  = this.$root.find('input.rw-chk[data-group="images"]:checked').length;
const siteSel = this.$root.find('input.rw-chk[data-group="sites"]:checked').length;
this.$root.find("#rw-selection-info").text(
`${imgSel} image${imgSel !== 1 ? "s" : ""} + ${siteSel} site${siteSel !== 1 ? "s" : ""} selected`
);
}

// ── Import action ─────────────────────────────────────────────────────────
async _do_import() {
const d = this.scanData;

const selectedImages = [];
this.$root.find('input.rw-chk[data-group="images"]:checked').each(function () {
const idx = parseInt($(this).data("idx"));
selectedImages.push(d.images[idx]);
});

const selectedSites = [];
this.$root.find('input.rw-chk[data-group="sites"]:checked').each(function () {
const idx = parseInt($(this).data("idx"));
selectedSites.push(d.sites[idx]);
});

if (!selectedImages.length && !selectedSites.length) {
frappe.msgprint("Nothing selected to import.");
return;
}

const $btn = this.$root.find("#rw-import-btn");
$btn.prop("disabled", true).text("Importing…");

try {
const r = await frappe.call({
method: "nano_press.nano_press.page.recovery_wizard.recovery_wizard.import_recovery_data",
args: {
images: JSON.stringify(selectedImages),
sites:  JSON.stringify(selectedSites),
},
freeze: true,
freeze_message: "Creating records…",
});
this._render_step3(r.message);
} catch (e) {
frappe.msgprint({ title: "Import Failed", message: String(e), indicator: "red" });
$btn.prop("disabled", false).text("Import Selected");
}
}

// ── Step 3: Results ───────────────────────────────────────────────────────
_render_step3(result) {
this.$root.find("#rw-step2").removeClass("active");
const $step3 = this.$root.find("#rw-step3").addClass("active");

const ci = result.created_images || [];
const cs = result.created_sites  || [];
const sk = result.skipped        || [];

const imgLinks = ci.map(name =>
`<a class="rw-created-link" href="/app/custom-image/${encodeURIComponent(name)}">${frappe.utils.escape_html(name)}</a>`
).join("");
const siteLinks = cs.map(name =>
`<a class="rw-created-link" href="/app/frappe-site/${encodeURIComponent(name)}">${frappe.utils.escape_html(name)}</a>`
).join("");
const skipRows = sk.map(s =>
`<li>${frappe.utils.escape_html(s.type)} <strong>${frappe.utils.escape_html(s.ref)}</strong> — ${frappe.utils.escape_html(s.reason)}</li>`
).join("");

$step3.html(`
<div class="rw-summary-grid">
${this._stat(ci.length, "Images Imported", "rw-stat-num np-green")}
${this._stat(cs.length, "Sites Imported",  "rw-stat-num np-green")}
${this._stat(sk.length, "Skipped",         sk.length ? "rw-stat-num np-orange" : "rw-stat-num")}
</div>

${ci.length ? `
<div class="rw-section-title">Created Custom Images</div>
<div class="rw-card">${imgLinks}</div>` : ""}

${cs.length ? `
<div class="rw-section-title">Created Frappe Sites</div>
<div class="rw-card">${siteLinks}</div>` : ""}

${sk.length ? `
<div class="rw-section-title">Skipped</div>
<div class="rw-card"><ul style="margin:0;padding-left:18px">${skipRows}</ul></div>` : ""}

<div class="rw-warn-box" style="margin-top:16px">
<strong>Next steps:</strong>
<ul style="margin:6px 0 0; padding-left:18px">
<li>Re-enter Apps catalog entries (repo URLs, branches, PAT tokens) for each app.</li>
<li>Assign a <strong>Customer</strong> to each recovered Frappe Site for billing.</li>
<li>Verify site status and run "Check Status" if needed.</li>
</ul>
</div>

<div class="rw-actions">
<button class="btn btn-default" id="rw-restart-btn">Start Over</button>
<a class="btn btn-default" href="/app/custom-image">View Custom Images</a>
<a class="btn btn-default" href="/app/frappe-site">View Frappe Sites</a>
</div>
`);

$step3.find("#rw-restart-btn").on("click", () => {
$step3.removeClass("active");
this.scanData = null;
this._render_step1();
});
}
}
