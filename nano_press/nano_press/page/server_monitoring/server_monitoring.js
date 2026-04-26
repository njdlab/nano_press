frappe.pages["server-monitoring"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Server Monitoring Dashboard",
		single_column: true,
	});

	page.set_secondary_action("Refresh Data", () => dashboard.refresh(), { icon: "refresh" });

	$(wrapper).find(".page-content").append(`<div id="np-monitoring-root"></div>`);

	const dashboard = new ServerMonitoringDashboard(wrapper);
	wrapper._dashboard = dashboard;
};

frappe.pages["server-monitoring"].on_page_show = function (wrapper) {
	if (wrapper._dashboard) wrapper._dashboard.refresh();
};

// ─── CSS ────────────────────────────────────────────────────────────────────
const STYLES = `
#np-monitoring-root {
	padding: 16px 0 32px;
	font-family: var(--font-stack);
}
.np-subtitle {
	color: var(--text-muted);
	font-size: var(--text-sm);
	margin-top: -8px;
	margin-bottom: 20px;
}
/* card grid rows */
.np-grid {
	display: grid;
	gap: 16px;
	margin-bottom: 16px;
}
.np-grid-3 { grid-template-columns: repeat(3, 1fr); }
.np-grid-2 { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 768px) {
	.np-grid-3, .np-grid-2 { grid-template-columns: 1fr; }
}
/* stat card */
.np-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--border-radius-lg);
	padding: 18px 20px;
}
.np-card-label {
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--text-muted);
	margin-bottom: 14px;
}
/* stat numbers row */
.np-stat-row { display: flex; gap: 24px; }
.np-stat { text-align: center; }
.np-stat-num {
	font-size: 32px;
	font-weight: 700;
	line-height: 1.1;
}
.np-stat-sub {
	font-size: 11px;
	color: var(--text-muted);
	margin-top: 3px;
	font-weight: 600;
}
.np-green  { color: var(--green-500, #22c55e); }
.np-orange { color: var(--orange-500, #f97316); }
.np-red    { color: var(--red-500, #ef4444); }
.np-blue   { color: var(--blue-500, #3b82f6); }
.np-gray   { color: var(--text-color); }
/* progress bars */
.np-progress-row { display: flex; flex-direction: column; gap: 12px; }
.np-progress-item {}
.np-progress-header {
	display: flex;
	justify-content: space-between;
	font-size: 12px;
	color: var(--text-muted);
	margin-bottom: 5px;
}
.np-progress-track {
	height: 6px;
	background: var(--bg-light-gray, #f3f4f6);
	border-radius: 99px;
	overflow: hidden;
}
.np-progress-fill {
	height: 100%;
	border-radius: 99px;
	background: var(--blue-500, #3b82f6);
	transition: width 0.4s ease;
}
/* alert no-alerts */
.np-no-alerts { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
/* server details section */
.np-section-title {
	font-size: 15px;
	font-weight: 600;
	color: var(--heading-color);
	margin: 20px 0 10px;
}
.np-server-list {
	border: 1px solid var(--border-color);
	border-radius: var(--border-radius-lg);
	overflow: hidden;
}
.np-server-row { border-bottom: 1px solid var(--border-color); }
.np-server-row:last-child { border-bottom: none; }
/* row header (clickable) */
.np-server-header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	cursor: pointer;
	background: var(--card-bg);
	border: none;
	width: 100%;
	text-align: left;
	transition: background 0.1s;
}
.np-server-header:hover { background: var(--bg-light-gray, #f9fafb); }
.np-health-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	flex-shrink: 0;
}
.np-dot-green  { background: #22c55e; }
.np-dot-orange { background: #f97316; }
.np-dot-red    { background: #ef4444; }
.np-server-name { font-size: 13px; font-weight: 600; color: var(--heading-color); flex: 1; }
.np-mini-badges { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); }
.np-mini-badges strong { color: var(--text-color); }
.np-chevron {
	width: 16px; height: 16px;
	color: var(--text-muted);
	transition: transform 0.2s;
	flex-shrink: 0;
}
.np-chevron.open { transform: rotate(180deg); }
/* expanded body */
.np-server-body {
	display: none;
	padding: 0 16px 16px;
	background: var(--bg-light-gray, #f9fafb);
}
.np-server-body.open { display: block; }
/* resource cards grid (3 cols) */
.np-res-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 12px;
	margin-top: 14px;
}
@media (max-width: 640px) { .np-res-grid { grid-template-columns: 1fr; } }
.np-res-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--border-radius);
	padding: 14px 16px;
}
.np-res-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 10px;
}
.np-res-accent { width: 4px; height: 18px; border-radius: 99px; flex-shrink: 0; }
.np-res-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.np-res-value { font-size: 22px; font-weight: 700; color: var(--heading-color); margin-bottom: 8px; }
/* count cards grid (4 cols) */
.np-count-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 10px;
	margin-top: 10px;
}
@media (max-width: 640px) { .np-count-grid { grid-template-columns: repeat(2, 1fr); } }
.np-count-card {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--border-radius);
	padding: 12px 14px;
}
.np-count-label { font-size: 11px; color: var(--text-muted); }
.np-count-value { font-size: 18px; font-weight: 700; color: var(--heading-color); margin-top: 2px; }
/* footer row in expanded */
.np-server-footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-top: 10px;
	padding: 0 2px;
	font-size: 11px;
}
.np-health-status { display: flex; align-items: center; gap: 5px; }
.np-health-label { color: var(--text-muted); }
.np-health-value { font-weight: 600; }
.np-health-reason { color: var(--text-muted); }
.np-last-updated { color: var(--text-muted); }
/* loading skeleton */
.np-loading {
	padding: 60px;
	text-align: center;
	color: var(--text-muted);
	font-size: 13px;
}
`;

// ─── Dashboard class ─────────────────────────────────────────────────────────
class ServerMonitoringDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.$root = $(wrapper).find("#np-monitoring-root");
		this._expanded = new Set();
		this._inject_styles();
		this.refresh();
	}

	_inject_styles() {
		if (!document.getElementById("np-monitoring-styles")) {
			const el = document.createElement("style");
			el.id = "np-monitoring-styles";
			el.textContent = STYLES;
			document.head.appendChild(el);
		}
	}

	async refresh() {
		this.$root.html(`<div class="np-loading">Loading dashboard…</div>`);
		try {
			const r = await frappe.call({ method: "nano_press.www.monitoring.get_dashboard_data" });
			this.data = r.message;
			this._render();
		} catch (e) {
			this.$root.html(`<div class="np-loading text-danger">Failed to load dashboard data.</div>`);
		}
	}

	_render() {
		const d = this.data;
		this.$root.html(`
			<p class="np-subtitle">Real-time monitoring of your Nano Press infrastructure</p>

			${this._row1(d)}
			${this._row2(d)}

			<div class="np-section-title">Server Details</div>
			<div class="np-server-list" id="np-server-list">
				${d.servers.length === 0
					? `<div class="np-loading">No servers found.</div>`
					: d.servers.map(s => this._server_row(s)).join("")
				}
			</div>
		`);

		// Attach accordion toggles
		this.$root.find(".np-server-header").on("click", (e) => {
			const name = e.currentTarget.dataset.server;
			this._toggle(name);
		});

		// Auto-expand first server
		if (d.servers.length > 0) {
			this._expand(d.servers[0].name);
		}
	}

	_row1(d) {
		return `
		<div class="np-grid np-grid-3">
			<div class="np-card">
				<div class="np-card-label">Server Health Status</div>
				<div class="np-stat-row">
					<div class="np-stat">
						<div class="np-stat-num np-green">${d.health_healthy}</div>
						<div class="np-stat-sub">HEALTHY</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-orange">${d.health_warning}</div>
						<div class="np-stat-sub">WARNING</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-red">${d.health_critical}</div>
						<div class="np-stat-sub">CRITICAL</div>
					</div>
				</div>
			</div>

			<div class="np-card">
				<div class="np-card-label">Average Resource Capacity</div>
				<div class="np-progress-row">
					${this._progress_bar("CPU Usage", d.avg_cpu)}
					${this._progress_bar("Memory Usage", d.avg_ram)}
					${this._progress_bar("Disk Usage", d.avg_disk)}
				</div>
			</div>

			<div class="np-card">
				<div class="np-card-label">Docker Images Inventory</div>
				<div class="np-stat-row">
					<div class="np-stat">
						<div class="np-stat-num np-blue">${d.total_built}</div>
						<div class="np-stat-sub">BUILT</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-blue">${d.total_used}</div>
						<div class="np-stat-sub">USED</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-blue">${d.total_unused}</div>
						<div class="np-stat-sub">UNUSED</div>
					</div>
				</div>
			</div>
		</div>`;
	}

	_row2(d) {
		return `
		<div class="np-grid np-grid-3">
			<div class="np-card">
				<div class="np-card-label">Frappe Sites Status</div>
				<div class="np-stat-row">
					<div class="np-stat">
						<div class="np-stat-num np-green">${d.sites_running}</div>
						<div class="np-stat-sub">RUNNING</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-orange">${d.sites_stopped}</div>
						<div class="np-stat-sub">STOPPED</div>
					</div>
					<div class="np-stat">
						<div class="np-stat-num np-red">${d.sites_failed}</div>
						<div class="np-stat-sub">FAILED</div>
					</div>
				</div>
			</div>

			<div class="np-card">
				<div class="np-card-label">Active Alerts</div>
				<div class="np-stat-num np-gray">${d.active_alerts_count}</div>
				${d.active_alerts_count === 0
					? `<div class="np-no-alerts">No active alerts</div>`
					: `<div class="np-no-alerts np-orange">${d.active_alerts_count} alert${d.active_alerts_count === 1 ? "" : "s"} require attention</div>`
				}
			</div>

			<div class="np-card">
				<div class="np-card-label">Infrastructure Summary</div>
				<div class="np-stat-row" style="align-items:center;gap:12px;">
					<div class="np-stat-num np-blue" style="font-size:36px;">${d.total_servers}</div>
					<div>
						<div style="font-size:13px;font-weight:600;color:var(--heading-color);">Total Servers</div>
						<div style="font-size:11px;color:var(--text-muted);">Registered in system</div>
					</div>
				</div>
			</div>
		</div>`;
	}

	_progress_bar(label, pct) {
		const safe = Math.min(pct, 100);
		return `
		<div class="np-progress-item">
			<div class="np-progress-header">
				<span>${label}</span>
				<span>${pct}%</span>
			</div>
			<div class="np-progress-track">
				<div class="np-progress-fill" style="width:${safe}%"></div>
			</div>
		</div>`;
	}

	_dot_class(status) {
		if (status === "Warning") return "np-dot-orange";
		if (status === "Critical") return "np-dot-red";
		return "np-dot-green";
	}

	_health_color(status) {
		if (status === "Warning") return "np-orange";
		if (status === "Critical") return "np-red";
		return "np-green";
	}

	_bar_color(pct, type) {
		if (pct >= 90) return "#ef4444";
		if (pct >= 70) return "#f97316";
		if (type === "cpu") return "#ef4444";
		if (type === "ram") return "#f97316";
		return "#22c55e";
	}

	_server_row(s) {
		return `
		<div class="np-server-row" id="np-row-${s.name.replace(/\W/g, "_")}">
			<button class="np-server-header" data-server="${frappe.utils.escape_html(s.name)}">
				<span class="np-health-dot ${this._dot_class(s.health_status)}"></span>
				<span class="np-server-name">${frappe.utils.escape_html(s.name)}</span>
				<span class="np-mini-badges">
					<span>CPU: <strong>${s.cpu}%</strong></span>
					<span>RAM: <strong>${s.ram}%</strong></span>
					<span>Disk: <strong>${s.disk}%</strong></span>
				</span>
				<svg class="np-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
				</svg>
			</button>
			<div class="np-server-body" id="np-body-${s.name.replace(/\W/g, "_")}">
				<div class="np-res-grid">
					${this._res_card("CPU Usage", s.cpu, "cpu")}
					${this._res_card("Memory Usage", s.ram, "ram")}
					${this._res_card("Disk Usage", s.disk, "disk")}
				</div>
				<div class="np-count-grid">
					${this._count_card("Running Sites", s.sites_running)}
					${this._count_card("Built Images", s.built_images)}
					${this._count_card("Used Images", s.used_images)}
					${this._count_card("Unused Images", s.unused_images)}
				</div>
				<div class="np-server-footer">
					<div class="np-health-status">
						<span class="np-health-label">Health Status:</span>
						<span class="np-health-value ${this._health_color(s.health_status)}">${frappe.utils.escape_html(s.health_status)}</span>
						${s.health_reason ? `<span class="np-health-reason">— ${frappe.utils.escape_html(s.health_reason)}</span>` : ""}
					</div>
					${s.metrics_at
						? `<span class="np-last-updated">Last updated: ${frappe.utils.escape_html(s.metrics_at)}</span>`
						: `<span class="np-last-updated">No metrics collected yet</span>`
					}
				</div>
			</div>
		</div>`;
	}

	_res_card(label, pct, type) {
		const accent_colors = { cpu: "#ef4444", ram: "#f97316", disk: "#22c55e" };
		const accent = accent_colors[type] || "#3b82f6";
		const bar_color = this._bar_color(pct, type);
		const safe = Math.min(pct, 100);
		return `
		<div class="np-res-card">
			<div class="np-res-card-header">
				<span class="np-res-accent" style="background:${accent}"></span>
				<span class="np-res-label">${label}</span>
			</div>
			<div class="np-res-value">${pct}%</div>
			<div class="np-progress-track">
				<div class="np-progress-fill" style="width:${safe}%;background:${bar_color}"></div>
			</div>
		</div>`;
	}

	_count_card(label, value) {
		return `
		<div class="np-count-card">
			<div class="np-count-label">${label}</div>
			<div class="np-count-value">${value}</div>
		</div>`;
	}

	_toggle(name) {
		if (this._expanded.has(name)) {
			this._collapse(name);
		} else {
			this._expand(name);
		}
	}

	_expand(name) {
		this._expanded.add(name);
		const safe = name.replace(/\W/g, "_");
		$(`#np-body-${safe}`).addClass("open");
		$(`[data-server="${name}"] .np-chevron`).addClass("open");
	}

	_collapse(name) {
		this._expanded.delete(name);
		const safe = name.replace(/\W/g, "_");
		$(`#np-body-${safe}`).removeClass("open");
		$(`[data-server="${name}"] .np-chevron`).removeClass("open");
	}
}
