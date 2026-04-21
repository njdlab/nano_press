import json

import frappe

from nano_press.nano_press.doctype.ansible_log.ansible_log import log_ansible_result
from nano_press.nano_press.utils.ansible.src.AnsibleRunner import AnsibleOps


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
