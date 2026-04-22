import json

import frappe
from frappe.utils import add_to_date, now_datetime

from nano_press.nano_press.doctype.ansible_log.ansible_log import log_ansible_result
from nano_press.nano_press.utils.ansible.src.AnsibleRunner import AnsibleOps

CPU_WARNING_THRESHOLD = 75.0
CPU_CRITICAL_THRESHOLD = 90.0
RAM_WARNING_THRESHOLD = 80.0
RAM_CRITICAL_THRESHOLD = 92.0
DISK_WARNING_THRESHOLD = 80.0
DISK_CRITICAL_THRESHOLD = 90.0


@frappe.whitelist()
def run_playbook(**kwargs):
	"""
	Run an Ansible playbook on a server and log the result.

	Accepted args (one of host or server_name is required):
	  - host / server_ip:    IP or DNS of the server
	  - server_name:         name of the Server doctype record

	Optional (class can auto-resolve from Server doctype if omitted):
	  - user, port, private_key

	Playbook:
	  - playbook_path: absolute path OR short name like "prepare" / "prepare.yml"
	  - extra_vars: dict (JSON)
	  - become: bool
	  - become_user: str
	  - timeout: int (seconds)
	"""
	try:
		host = kwargs.get("host") or kwargs.get("server_ip")
		server_name = kwargs.get("server_name")
		playbook_arg = kwargs.get("playbook_path")
		if not playbook_arg or not (host or server_name):
			frappe.throw("Missing required fields: playbook_path and one of host or server_name")

		extra_vars = kwargs.get("extra_vars", {}) or {}
		become = bool(kwargs.get("become", False))
		become_user = kwargs.get("become_user")
		timeout = kwargs.get("timeout")
		event_handler = kwargs.get("event_handler")

		runner = AnsibleOps()
		result = runner.run_playbook(
			server_ip=host,
			server_name=server_name,
			playbook_path=playbook_arg,
			extra_vars=extra_vars,
			become=become,
			become_user=become_user,
			timeout=int(timeout) if timeout else None,
			event_handler=event_handler,
		)

		stats = result.get("stats", {})
		host_stats = next(iter(stats.values())) if stats else {}
		failures = host_stats.get("failures", 0)
		ok = bool(result.get("ok")) and failures == 0

		if server_name:
			server_docname = server_name
		else:
			server_docname = frappe.db.get_value("Server", {"server_ip": host}, "name")
			if not server_docname:
				frappe.throw(f"No Server document found with server_ip={host}")

		log_id = log_ansible_result(
			result_json=result,
			operation="Playbook",
			server=server_docname,
			bench=extra_vars.get("bench_name"),
			site=None,
		)

		return {
			"status": "success" if ok else "error",
			"ok": ok,
			"bench": extra_vars.get("bench_name"),
			"server": server_docname,
			"message": f"Playbook executed on {server_docname}",
			"log_id": log_id,
			"data": result,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "run_playbook API error")
		return {"status": "error", "message": str(e)}


@frappe.whitelist()
def ping_server(**kwargs):
	"""
	Ping a remote server via Ansible and log the result.

	Accepted args (one of host or server_name is required):
	  - host:        server IP / DNS (alias: server_ip)
	  - server_name: name of Server doctype record (primary key)

	Optional (class will auto-resolve from Server doctype if omitted):
	  - user
	  - port
	  - private_key
	"""
	try:
		host = kwargs.get("host") or kwargs.get("server_ip")
		server_name = kwargs.get("server_name")

		if not host and not server_name:
			frappe.throw("Provide either 'host' (server_ip) or 'server_name'")

		runner = AnsibleOps()
		result = runner.run_ping(
			server_ip=host,
			server_name=server_name,
		)

		ok = bool(result.get("ok"))

		if server_name:
			server_docname = server_name
		else:
			server_docname = frappe.db.get_value("Server", {"server_ip": host}, "name")
			if not server_docname:
				frappe.throw(f"No Server document found with server_ip={host}")

		# Get current server status to decide what to set
		server = frappe.get_cached_doc("Server", server_docname)
		current_status = server.verify_status

		# Determine status to set:
		# - If ping fails, mark as "Failed" (actual connectivity issue)
		# - If ping succeeds but server is "Prepared", keep it "Prepared" (just update last_verified_at)
		# - If ping succeeds but server is not "Prepared", mark as "Verified" (basic connectivity confirmed)
		if not ok:
			status = "Failed"
		elif current_status == "Prepared":
			status = "Prepared"  # Preserve Prepared status, just update timestamp
		else:
			status = "Verified"

		frappe.db.set_value(
			"Server",
			server_docname,
			{"verify_status": status, "last_verified_at": frappe.utils.now_datetime()},
		)
		frappe.db.commit()

		log_id = log_ansible_result(
			result_json=result,
			operation="Ping",
			server=server_docname,
		)

		return {
			"status": "success" if ok else "error",
			"ok": ok,
			"server": server_docname,
			"message": f"Ping executed on {server_docname}",
			"log_id": log_id,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "ping_server API error")
		return {"status": "error", "message": str(e)}


def periodic_health_check():
	"""
	Periodic background job to check health of all Prepared servers.

	This function is called by the scheduler every 5 minutes.
	It pings servers in "Prepared" or "Verified" status to ensure they are still reachable.
	Preserves the "Prepared" status if the server is still reachable.

	Sets status to "Failed" only if a server that was previously reachable becomes unreachable.
	"""
	try:
		# Get all servers that are either Prepared or Verified
		servers = frappe.get_all(
			"Server",
			filters={"verify_status": ["in", ["Prepared", "Verified"]]},
			fields=["name", "server_ip"],
		)

		if not servers:
			frappe.logger().info("No servers to health check")
			return

		frappe.logger().info(f"Starting periodic health check for {len(servers)} servers")

		for server_doc in servers:
			try:
				ping_server(server_name=server_doc.get("name"))
			except Exception as e:
				frappe.logger().error(f"Health check failed for {server_doc.get('name')}: {e!s}")
				# Don't break the loop - continue checking other servers

		frappe.logger().info("Periodic health check completed")

	except Exception as e:
		frappe.logger().error(f"Error in periodic_health_check: {e!s}")
		frappe.log_error(frappe.get_traceback(), "periodic_health_check error")


def _safe_float(value, default=0.0):
	try:
		return float(value)
	except (TypeError, ValueError):
		return float(default)


def _parse_metrics_output(stdout: str) -> dict:
	metrics = {}
	for raw_line in (stdout or "").splitlines():
		line = raw_line.strip()
		if not line or "=" not in line:
			continue
		key, value = line.split("=", 1)
		metrics[key.strip()] = value.strip()

	return {
		"cpu_percent": _safe_float(metrics.get("cpu_percent")),
		"ram_percent": _safe_float(metrics.get("ram_percent")),
		"disk_percent": _safe_float(metrics.get("disk_percent")),
		"load_1m": _safe_float(metrics.get("load_1m")),
		"ram_total_gb": _safe_float(metrics.get("ram_total_gb")),
		"ram_used_gb": _safe_float(metrics.get("ram_used_gb")),
		"disk_total_gb": _safe_float(metrics.get("disk_total_gb")),
		"disk_used_gb": _safe_float(metrics.get("disk_used_gb")),
	}


def _extract_task_stdout(result_json: dict, task_name: str) -> str:
	raw_json = result_json.get("raw_json", {}) or {}
	for play in raw_json.get("plays", []):
		for task in play.get("tasks", []):
			name = (task.get("task") or {}).get("name")
			if name != task_name:
				continue
			for host_result in (task.get("hosts") or {}).values():
				return (host_result or {}).get("stdout") or ""
	return ""


def _get_image_and_site_counts(server_name: str) -> dict:
	built_images = frappe.get_all(
		"Custom Image",
		filters={"server_name": server_name, "build_status": "Built"},
		fields=["name"],
	)
	built_image_names = {row.name for row in built_images}

	sites = frappe.get_all(
		"Frappe Site",
		filters={"server_name": server_name},
		fields=["name", "status", "custom_image"],
	)

	used_image_names = {
		row.custom_image
		for row in sites
		if row.custom_image
		and row.status in ("Deployed", "Stopped", "Failed", "Deploying", "Ready To Deploy")
	}
	used_image_names = used_image_names & built_image_names

	return {
		"sites_running_count": sum(1 for row in sites if row.status == "Deployed"),
		"sites_stopped_count": sum(1 for row in sites if row.status == "Stopped"),
		"sites_failed_count": sum(1 for row in sites if row.status == "Failed"),
		"built_images_count": len(built_image_names),
		"used_images_count": len(used_image_names),
		"unused_images_count": max(len(built_image_names) - len(used_image_names), 0),
	}


def _get_health_status(metrics: dict) -> tuple[str, str]:
	reasons = []
	severity = "Healthy"

	if metrics["cpu_percent"] >= CPU_CRITICAL_THRESHOLD:
		severity = "Critical"
		reasons.append(f"CPU high ({metrics['cpu_percent']:.1f}%)")
	elif metrics["cpu_percent"] >= CPU_WARNING_THRESHOLD:
		if severity != "Critical":
			severity = "Warning"
		reasons.append(f"CPU elevated ({metrics['cpu_percent']:.1f}%)")

	if metrics["ram_percent"] >= RAM_CRITICAL_THRESHOLD:
		severity = "Critical"
		reasons.append(f"RAM high ({metrics['ram_percent']:.1f}%)")
	elif metrics["ram_percent"] >= RAM_WARNING_THRESHOLD:
		if severity != "Critical":
			severity = "Warning"
		reasons.append(f"RAM elevated ({metrics['ram_percent']:.1f}%)")

	if metrics["disk_percent"] >= DISK_CRITICAL_THRESHOLD:
		severity = "Critical"
		reasons.append(f"Disk high ({metrics['disk_percent']:.1f}%)")
	elif metrics["disk_percent"] >= DISK_WARNING_THRESHOLD:
		if severity != "Critical":
			severity = "Warning"
		reasons.append(f"Disk elevated ({metrics['disk_percent']:.1f}%)")

	reason = "; ".join(reasons) if reasons else "All monitored metrics are within healthy thresholds"
	return severity, reason


def _resolve_active_alerts(server_name: str):
	if not frappe.db.exists("DocType", "Server Health Alert"):
		return

	active_alerts = frappe.get_all(
		"Server Health Alert",
		filters={"server": server_name, "is_active": 1},
		fields=["name"],
	)

	for alert in active_alerts:
		frappe.db.set_value(
			"Server Health Alert",
			alert.name,
			{"is_active": 0, "resolved_at": now_datetime()},
		)


def _upsert_server_alert(server_name: str, health_status: str, health_reason: str):
	if not frappe.db.exists("DocType", "Server Health Alert"):
		return

	if health_status == "Healthy":
		_resolve_active_alerts(server_name)
		return

	active = frappe.get_all(
		"Server Health Alert",
		filters={"server": server_name, "is_active": 1},
		fields=["name", "severity", "message"],
		order_by="creation desc",
		limit=1,
	)

	if active and active[0].severity == health_status and (active[0].message or "") == (health_reason or ""):
		return

	_resolve_active_alerts(server_name)
	frappe.get_doc(
		{
			"doctype": "Server Health Alert",
			"server": server_name,
			"metric_type": "Runtime",
			"severity": health_status,
			"is_active": 1,
			"message": health_reason,
			"opened_at": now_datetime(),
		}
	).insert(ignore_permissions=True)


def _save_metrics(server_name: str, metrics: dict, counts: dict, health_status: str, health_reason: str):
	now = now_datetime()

	if frappe.db.exists("DocType", "Server Metrics Snapshot"):
		frappe.get_doc(
			{
				"doctype": "Server Metrics Snapshot",
				"server": server_name,
				"captured_at": now,
				"health_status": health_status,
				"health_reason": health_reason,
				**metrics,
				**counts,
			}
		).insert(ignore_permissions=True)

	frappe.db.set_value(
		"Server",
		server_name,
		{
			"latest_metrics_at": now,
			"latest_health_status": health_status,
			"latest_health_reason": health_reason,
			"latest_cpu_percent": metrics.get("cpu_percent", 0),
			"latest_ram_percent": metrics.get("ram_percent", 0),
			"latest_disk_percent": metrics.get("disk_percent", 0),
			"latest_sites_running_count": counts.get("sites_running_count", 0),
			"latest_built_images_count": counts.get("built_images_count", 0),
			"latest_used_images_count": counts.get("used_images_count", 0),
			"latest_unused_images_count": counts.get("unused_images_count", 0),
		},
	)

	_upsert_server_alert(server_name, health_status, health_reason)


def _collect_server_metrics(server_name: str) -> dict:
	counts = _get_image_and_site_counts(server_name)
	default_metrics = {
		"cpu_percent": 0.0,
		"ram_percent": 0.0,
		"disk_percent": 0.0,
		"load_1m": 0.0,
		"ram_total_gb": 0.0,
		"ram_used_gb": 0.0,
		"disk_total_gb": 0.0,
		"disk_used_gb": 0.0,
	}

	try:
		runner = AnsibleOps()
		result = runner.run_playbook(
			server_name=server_name,
			playbook_path="server_metrics.yml",
			become=False,
			timeout=180,
		)

		if not bool(result.get("ok")):
			health_reason = result.get("stderr_tail") or result.get("stderr") or "Server metrics check failed"
			_save_metrics(server_name, default_metrics, counts, "Critical", health_reason)
			frappe.db.commit()
			return {
				"status": "error",
				"ok": False,
				"server": server_name,
				"health_status": "Critical",
				"health_reason": health_reason,
			}

		stdout = _extract_task_stdout(result, "Collect server metrics")
		metrics = _parse_metrics_output(stdout)
		health_status, health_reason = _get_health_status(metrics)

		_save_metrics(server_name, metrics, counts, health_status, health_reason)
		frappe.db.commit()

		return {
			"status": "success",
			"ok": True,
			"server": server_name,
			"health_status": health_status,
			"health_reason": health_reason,
			"metrics": metrics,
			"counts": counts,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"metrics collection failed for {server_name}")
		_save_metrics(server_name, default_metrics, counts, "Critical", f"Metrics collection error: {e!s}")
		frappe.db.commit()
		return {
			"status": "error",
			"ok": False,
			"server": server_name,
			"health_status": "Critical",
			"health_reason": f"Metrics collection error: {e!s}",
		}


@frappe.whitelist()
def refresh_server_metrics_for_server(server_name: str):
	if not server_name:
		frappe.throw("Server name is required")

	if not frappe.db.exists("Server", server_name):
		frappe.throw(f"Server {server_name} not found")

	return _collect_server_metrics(server_name)


def periodic_metrics_collection():
	"""Collect periodic CPU, RAM, Disk, runtime and image usage metrics for each active server."""
	try:
		servers = frappe.get_all(
			"Server",
			filters={"verify_status": ["in", ["Prepared", "Verified"]]},
			fields=["name"],
		)

		for server_doc in servers:
			_collect_server_metrics(server_doc.name)

	except Exception as e:
		frappe.logger().error(f"Error in periodic_metrics_collection: {e!s}")
		frappe.log_error(frappe.get_traceback(), "periodic_metrics_collection error")


def cleanup_old_server_metrics_snapshots(retention_days: int = 60):
	"""Delete old metric snapshots to keep table growth controlled."""
	if not frappe.db.exists("DocType", "Server Metrics Snapshot"):
		return

	cutoff = add_to_date(now_datetime(), days=-int(retention_days))
	frappe.db.sql("DELETE FROM `tabServer Metrics Snapshot` WHERE captured_at < %s", cutoff)
	frappe.db.commit()
