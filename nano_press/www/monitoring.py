import frappe


def get_context(context):
	context.no_cache = 1
	context.dashboard = get_dashboard_data()
	return context


@frappe.whitelist()
def get_dashboard_data():
	servers = frappe.get_all(
		"Server",
		fields=[
			"name",
			"server_ip",
			"verify_status",
			"latest_health_status",
			"latest_health_reason",
			"latest_cpu_percent",
			"latest_ram_percent",
			"latest_disk_percent",
			"latest_sites_running_count",
			"latest_built_images_count",
			"latest_used_images_count",
			"latest_unused_images_count",
			"latest_metrics_at",
		],
		order_by="name asc",
	)

	# Aggregate health status counts
	health_healthy = sum(1 for s in servers if s.latest_health_status == "Healthy")
	health_warning = sum(1 for s in servers if s.latest_health_status == "Warning")
	health_critical = sum(1 for s in servers if s.latest_health_status == "Critical")

	# Average resource usage across all servers that have metrics
	metric_servers = [s for s in servers if s.latest_metrics_at]
	avg_cpu = round(
		sum(s.latest_cpu_percent or 0 for s in metric_servers) / len(metric_servers), 1
	) if metric_servers else 0.0
	avg_ram = round(
		sum(s.latest_ram_percent or 0 for s in metric_servers) / len(metric_servers), 1
	) if metric_servers else 0.0
	avg_disk = round(
		sum(s.latest_disk_percent or 0 for s in metric_servers) / len(metric_servers), 1
	) if metric_servers else 0.0

	# Docker images totals
	total_built = sum(s.latest_built_images_count or 0 for s in servers)
	total_used = sum(s.latest_used_images_count or 0 for s in servers)
	total_unused = sum(s.latest_unused_images_count or 0 for s in servers)

	# Sites status from Frappe Site doctype
	sites_running = frappe.db.count("Frappe Site", {"status": "Deployed"})
	sites_stopped = frappe.db.count("Frappe Site", {"status": "Stopped"})
	sites_failed = frappe.db.count("Frappe Site", {"status": "Failed"})

	# Active alerts
	active_alerts_count = 0
	if frappe.db.exists("DocType", "Server Health Alert"):
		active_alerts_count = frappe.db.count("Server Health Alert", {"is_active": 1})

	# Format server list for template
	server_list = []
	for s in servers:
		server_list.append({
			"name": s.name,
			"server_ip": s.server_ip or "",
			"verify_status": s.verify_status or "Not Verified",
			"health_status": s.latest_health_status or "Healthy",
			"health_reason": s.latest_health_reason or "",
			"cpu": round(s.latest_cpu_percent or 0, 1),
			"ram": round(s.latest_ram_percent or 0, 1),
			"disk": round(s.latest_disk_percent or 0, 1),
			"sites_running": s.latest_sites_running_count or 0,
			"built_images": s.latest_built_images_count or 0,
			"used_images": s.latest_used_images_count or 0,
			"unused_images": s.latest_unused_images_count or 0,
			"metrics_at": frappe.utils.format_datetime(s.latest_metrics_at) if s.latest_metrics_at else None,
			"has_metrics": bool(s.latest_metrics_at),
		})

	return {
		"health_healthy": health_healthy,
		"health_warning": health_warning,
		"health_critical": health_critical,
		"avg_cpu": avg_cpu,
		"avg_ram": avg_ram,
		"avg_disk": avg_disk,
		"total_built": total_built,
		"total_used": total_used,
		"total_unused": total_unused,
		"sites_running": sites_running,
		"sites_stopped": sites_stopped,
		"sites_failed": sites_failed,
		"active_alerts_count": active_alerts_count,
		"total_servers": len(servers),
		"servers": server_list,
	}
