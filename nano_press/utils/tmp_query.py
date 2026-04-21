import frappe

from nano_press.utils import ansible_runner


def collect():
	r = ansible_runner.run_playbook(
		server_name="SERVER-00071",
		playbook_path="restart_site.yml",
		extra_vars={"bench_name": "BENCH-0106"},
		timeout=900,
	)
	data = r.get("data", {}) or {}
	d = frappe.get_doc("Frappe Site", "BENCH-0106")
	return {
		"restart_status": r.get("status"),
		"restart_message": r.get("message"),
		"stderr_tail": (data.get("stderr_tail") or "")[-1200:],
		"stdout_tail": (data.get("stdout_tail") or "")[-1200:],
		"runtime_state": d._get_runtime_state(),
	}
