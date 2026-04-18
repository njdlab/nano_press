# Copyright (c) 2025, Venkatesh M and contributors
# For license information, please see license.txt

import os
import re
import subprocess

import frappe
from frappe.model.document import Document

from ..ansible_log.ansible_log import log_ansible_result
from nano_press.utils.ansible_runner import run_playbook


def _prepare_server_task_total() -> int:
	playbook_path = frappe.get_app_path(
		"nano_press", "nano_press", "utils", "ansible", "playbooks", "prepare_server.yml"
	)
	with open(playbook_path, encoding="utf-8") as handle:
		return max(len(re.findall(r"^\s*-\s+name:\s+", handle.read(), flags=re.MULTILINE)), 1)


def _task_stage(task_name: str, include_traefik: bool) -> str:
	if include_traefik and "traefik" in task_name.lower():
		return "Deploying Traefik"
	return "Installing Docker & Compose"


class Server(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		compose_installed: DF.Check
		compose_version: DF.Data | None
		docker_installed: DF.Check
		docker_version: DF.Data | None
		last_prepared_at: DF.Datetime | None
		last_verified_at: DF.Datetime | None
		server_ip: DF.Data
		server_name: DF.Data
		ssh_port: DF.Int
		ssh_user: DF.Data
		traefik_deployed: DF.Check
		traefik_domain: DF.Data
		traefik_email: DF.Data
		traefik_password: DF.Password
		traefik_username: DF.Data
		traefik_version: DF.Data | None
		verify_status: DF.Literal[
			"Not Verified", "Verifying", "Verified", "Failed", "Not Prepared", "Preparing", "Prepared"
		]
	# end: auto-generated types

	def validate(self):
		if not self.traefik_email:
			self.traefik_email = frappe.session.user
		self.created_by = frappe.session.user
		if self.name:
			self.server_name = self.name

	@staticmethod
	def _read_local_public_key() -> str | None:
		"""Attempt to read a usable SSH public key from standard locations.

		Returns the first available public key content, or None.
		"""
		candidate_paths = [
			os.path.expanduser(path)
			for path in [
				"~/.ssh/id_ed25519.pub",
				"~/.ssh/id_rsa.pub",
				"~/.ssh/id_ecdsa.pub",
				"~/.ssh/id_dsa.pub",
			]
		]
		for candidate in candidate_paths:
			try:
				if os.path.exists(candidate):
					with open(candidate) as fh:
						data = fh.read().strip()
						if data:
							return data
			except Exception:
				continue
		private_candidates = [
			os.path.expanduser(p)
			for p in [
				"~/.ssh/id_ed25519",
				"~/.ssh/id_rsa",
				"~/.ssh/id_ecdsa",
				"~/.ssh/id_dsa",
			]
		]
		for private_key in private_candidates:
			try:
				if os.path.exists(private_key):
					result = subprocess.run(
						["ssh-keygen", "-y", "-f", private_key],
						stdout=subprocess.PIPE,
						stderr=subprocess.DEVNULL,
						text=True,
						check=False,
					)
					pub = (result.stdout or "").strip()
					if pub:
						return pub
			except Exception:
				continue
		return None

	def prepare_server(self, include_traefik=False):
		"""
		Unified server preparation that installs Docker, Docker Compose, and optionally Traefik.
		Checks if components are already installed before attempting installation.

		Args:
			include_traefik: Whether to also deploy Traefik (default: False, requires traefik fields to be set)
		"""
		if include_traefik:
			if self.docker_installed and self.compose_installed and self.traefik_deployed:
				return {
					"status": 200,
					"message": "Server is already prepared with Docker, Docker Compose, and Traefik",
					"docker_version": self.docker_version or "Unknown",
					"compose_version": self.compose_version or "Unknown",
					"traefik_version": self.traefik_version or "Unknown",
					"skipped": True,
				}
		else:
			if self.docker_installed and self.compose_installed:
				return {
					"status": 200,
					"message": "Server is already prepared with Docker and Docker Compose",
					"docker_version": self.docker_version or "Unknown",
					"compose_version": self.compose_version or "Unknown",
					"skipped": True,
				}

		extra_vars = {}

		if include_traefik:
			if not self.traefik_domain:
				frappe.throw(frappe._("Traefik domain is required for Traefik deployment"))
			if not self.traefik_email:
				frappe.throw(frappe._("Traefik email is required for Traefik deployment"))
			if not self.traefik_username:
				frappe.throw(frappe._("Traefik username is required for Traefik deployment"))
			if not self.traefik_password:
				frappe.throw(frappe._("Traefik password is required for Traefik deployment"))

			extra_vars = {
				"traefik_domain": self.traefik_domain,
				"traefik_email": self.traefik_email,
				"traefik_username": self.traefik_username,
				"traefik_password": self.get_password("traefik_password"),
			}

		# Enqueue the background task to avoid worker timeout
		frappe.enqueue_doc(
			"Server",
			self.name,
			"_prepare_server_background",
			queue="long",
			timeout=3600,
			include_traefik=include_traefik,
			extra_vars=extra_vars,
			requested_by=frappe.session.user,
		)

		return {
			"status": "queued",
			"message": "Server preparation started in background. Check the job queue for progress.",
		}

	def _prepare_server_background(self, include_traefik: bool, extra_vars: dict, requested_by: str | None = None):
		"""
		Background task to run the server preparation playbook and update the document.
		"""
		server = self
		_user = requested_by or "Administrator"
		task_total = _prepare_server_task_total()
		task_index = 0

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": server.name,
					"doc_type": "Server",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_ansible_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(12, round((task_index / task_total) * 92)))
				emit(
					_task_stage(task_name, include_traefik),
					percent,
					"running",
					f"Executing: {task_name}",
					task_name=task_name,
					task_state="running",
					task_index=task_index,
					task_total=task_total,
				)
				return

			if event.get("event") == "task_result":
				task_state = event.get("status") or "success"
				def _str(v):
					if isinstance(v, list):
						return "\n".join(str(i) for i in v)
					return str(v) if v else ""
				detail = _str(event.get("msg")) or _str(event.get("stderr")) or _str(event.get("stdout")) or ""
				emit(
					_task_stage(task_name, include_traefik),
					min(95, max(12, round((max(task_index, 1) / task_total) * 92))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		emit(
			"Installing Docker & Compose",
			10,
			"running",
			"Running prepare_server.yml — this may take several minutes...",
		)

		result = run_playbook(
			host=server.server_ip,
			playbook_path="prepare_server.yml",
			become=True,
			extra_vars=extra_vars if extra_vars else None,
			event_handler=handle_ansible_event,
		)
		log_ansible_result(result, operation="Playbook", server=server.name)

		if not result.get("ok"):
			error_msg = result.get("stderr_tail") or result.get("stderr") or "Unknown error"

			frappe.log_error(
				title="Server Preparation Failed",
				message=f"Server: {server.name}\nError: {error_msg}\nFull response: {frappe.as_json(result, indent=2)}",
			)

			# Update status to failed
			frappe.logger().info(f"Setting server {server.name} status to Failed")
			server.verify_status = "Failed"
			frappe.logger().info(f"About to save server {server.name} with status: {server.verify_status}")
			server.save()
			emit("Failed", 0, "failed", f"Server preparation failed: {error_msg}")
			return

		if result.get("stderr_tail"):
			frappe.log_error(f"Server preparation stderr: {result.get('stderr_tail')}", "Server Preparation Warning")

		docker_version = "Unknown"
		compose_version = "Unknown"
		traefik_version = None
		traefik_running = False

		raw_json = result.get("raw_json", {})
		plays = raw_json.get("plays", [])

		for play in plays:
			tasks = play.get("tasks", [])
			for task in tasks:
				task_info = task.get("task", {})
				task_name = task_info.get("name", "")
				hosts_data = task.get("hosts", {})

				for _host, host_result in hosts_data.items():
					if task_name == "Get Docker version":
						docker_version = host_result.get("stdout", "").strip() or "Unknown"
					elif task_name == "Get Docker Compose version":
						compose_version = host_result.get("stdout", "").strip() or "Unknown"
					elif task_name == "Check if Traefik is already running":
						if host_result.get("stdout", "").strip():
							traefik_running = True
					elif task_name == "Get Traefik version":
						traefik_version = host_result.get("stdout", "").strip() or "v2.11"
						traefik_running = True

		server.docker_installed = True
		server.docker_version = docker_version
		server.compose_installed = True
		server.compose_version = compose_version
		server.verify_status = "Prepared"
		server.last_prepared_at = frappe.utils.now_datetime()

		if include_traefik and (traefik_running or result.get("ok")):
			server.traefik_deployed = True
			server.traefik_version = traefik_version or server.traefik_version or "v2.11"

		server.save()

		done_msg = "Server prepared successfully with Docker" + (
			" and Traefik" if include_traefik else ""
		) + "!"
		emit("Complete", 100, "success", done_msg)




@frappe.whitelist()
def prepare_server(server_name: str, include_traefik: bool = False):
	"""
	Whitelisted wrapper to prepare a server by installing Docker, Docker Compose, and optionally Traefik.

	Args:
		server_name: Name of the Server document
		include_traefik: Whether to also deploy Traefik (default: False)

	Returns:
		dict with status, message, versions, and log_id
	"""
	if not server_name:
		frappe.throw("Server name is required")

	server = frappe.get_doc("Server", server_name)
	return server.prepare_server(include_traefik=include_traefik)




@frappe.whitelist()
def get_public_key_html() -> str:
	"""Render the server's local SSH public key as HTML instructions for the user.

	This reads a public key from the host running the Frappe app and returns an
	HTML snippet to show in the `public_key` HTML field.
	"""
	public_key = Server._read_local_public_key()
	if not public_key:
		return (
			'<div class="text-muted">No SSH public key found on the server. '
			"Ensure a key exists at ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub.</div>"
		)

	html = f"""
        <div>
            <p><strong>Server Public Key</strong></p>
            <div style=\"margin: 6px 0;\">
                <button id=\"copy-public-key-btn\" type=\"button\" class=\"btn btn-sm btn-secondary\">Copy Public Key</button>
            </div>
            <pre id=\"server-public-key\" style=\"white-space: pre-wrap; word-break: break-all;\">{frappe.utils.escape_html(public_key)}</pre>
            <p>Copy the above key into <code>~/.ssh/authorized_keys</code> on your remote server.
            Ensure file permissions are correct and SSH is enabled for the configured user.</p>
        </div>
    """
	return html
