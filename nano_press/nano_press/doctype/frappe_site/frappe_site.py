# Copyright (c) 2025, Venkatesh M and contributors
# For license information, please see license.txt

import json
import os
import re
import shutil
import time
from typing import Any

import frappe
from frappe.model.document import Document
from frappe.utils import random_string

from nano_press.utils.ansible_runner import run_playbook


def _count_playbook_tasks(playbook_name: str) -> int:
	playbook_path = frappe.get_app_path(
		"nano_press", "nano_press", "utils", "ansible", "playbooks", playbook_name
	)
	with open(playbook_path, encoding="utf-8") as handle:
		count = len(re.findall(r"^\s*-\s+name:\s+", handle.read(), flags=re.MULTILINE))
	return max(count, 1)


def _event_text(value) -> str:
	if isinstance(value, list):
		return "\n".join(str(v) for v in value)
	return str(value) if value else ""


def _site_action_progress_key(site_name: str, action: str, run_id: str) -> str:
	return f"nano_press:site_action_progress:{site_name}:{action}:{run_id}"


def _set_site_action_progress(site_name: str, action: str, run_id: str, payload: dict) -> None:
	if not run_id:
		return
	# Store as dict so get_value returns dict directly (avoids JSON/pickle mismatch)
	frappe.cache().set_value(
		_site_action_progress_key(site_name, action, run_id),
		payload,
		expires_in_sec=7200,
	)


def _get_site_action_progress(site_name: str, action: str, run_id: str) -> dict:
	if not run_id:
		return {}
	raw = frappe.cache().get_value(_site_action_progress_key(site_name, action, run_id))
	if not raw:
		return {}
	if isinstance(raw, dict):
		return raw
	# Fallback: try JSON parse if somehow stored as string
	try:
		return json.loads(raw)
	except Exception:
		return {}


def _check_action_completion(site_name: str, action: str, run_id: str) -> dict | None:
	"""
	Check if a backup/restore action is actually complete by looking at completion markers.
	Returns updated progress dict if completion detected, else None.
	"""
	if not run_id or not action:
		return None
	
	# Get current cached progress
	cached = _get_site_action_progress(site_name, action, run_id)
	current_percent = cached.get("percent", 0)
	current_status = cached.get("status", "")
	
	# If already marked success or failed, no need to check further
	if current_status in ("success", "failed"):
		return None
	
	# If we haven't heard updates in a while, check if site state changed as a marker
	update_timestamp_key = f"nano_press:action_last_update:{site_name}:{action}:{run_id}"
	last_update = frappe.cache().get_value(update_timestamp_key)
	
	if last_update:
		try:
			last_update_time = float(last_update)
			current_time = time.time()
			# If no updates for more than 30 seconds and percent is still low
			if current_time - last_update_time > 30 and current_percent < 90:
				# Check if the site actually has markers of completion
				try:
					doc = frappe.get_doc("Frappe Site", site_name)
					if doc.status == "Deployed":
						# Site is deployed, so restore/backup likely completed
						return {
							"percent": 100,
							"status": "success",
							"message": f"{action.capitalize()} completed.",
							"doc_name": site_name,
							"doc_type": "Frappe Site",
							"run_id": run_id,
						}
					elif doc.status == "Failed":
						# Site marked as failed, action must have failed
						return {
							"percent": 0,
							"status": "failed",
							"message": f"{action.capitalize()} failed. Site status is Failed.",
							"doc_name": site_name,
							"doc_type": "Frappe Site",
							"run_id": run_id,
						}
				except Exception as e:
					frappe.log_error(f"Error in _check_action_completion: {e}", "action_completion_error")
					pass
		except (ValueError, TypeError):
			pass
	
	return None


class FrappeSite(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from nano_press.nano_press.doctype.app_install_item.app_install_item import AppInstallItem

		admin_password: DF.Password
		active_subscription: DF.Link | None
		allow_overage: DF.Check
		amended_from: DF.Link | None
		bench_name: DF.Data
		billing_status: DF.Literal["Not Linked", "Active", "Grace", "Suspended", "Cancelled"]
		customer: DF.Link
		custom_image: DF.Link | None
		db_password: DF.Password | None
		db_username: DF.Data | None
		docker_image: DF.Data | None
		employee_limit: DF.Int
		install_apps: DF.Table[AppInstallItem]
		is_custom: DF.Check
		is_development: DF.Check
		last_deployed_at: DF.Datetime | None
		overage_policy: DF.Literal["Bill", "Block"]
		port: DF.Int
		server_name: DF.Link
		site_url: DF.Data | None
		storage_quota_gb: DF.Float
		suspension_reason: DF.Literal["Manual", "Billing", "Limit"]
		ssl_enabled: DF.Check
		status: DF.Literal["Not Deployed", "Ready To Deploy", "Deploying", "Deployed", "Failed", "Stopped"]
		username: DF.Data | None
	# end: auto-generated types

	def before_insert(self):
		self._ensure_password()

	def after_insert(self):
		bench_name = self.bench_name or self.name
		self.bench_name = bench_name

		if not self.site_url:
			self.site_url = self._generate_site_url(bench_name)

		self.flags.ignore_validate = True
		self.save(ignore_permissions=True)

	def before_save(self):
		if self.docstatus == 1:
			return
		if self.is_custom and self.custom_image and self.has_value_changed("custom_image"):
			self._sync_apps_from_custom_image()

		if getattr(self.flags, "skip_reprepare_reset", False):
			return

		if self._requires_reprepare():
			self.status = "Not Deployed"
			self.last_deployed_at = None
			frappe.msgprint(
				"Deployment configuration has changed. Status has been reset to <b>Not Deployed</b>. "
				"Please run <b>Prepare for Deployment</b> again to apply the new settings.",
				title="Re-preparation Required",
				indicator="orange",
				alert=True,
			)

	def validate(self):
		if not (self.customer or "").strip():
			frappe.throw("Customer is required for each site.")
		self.validate_server()
		self.validate_custom_image_constraints()
		if self.docstatus == 0:
			self._ensure_password()

	def validate_server(self):
		linked_server = (self.server_name or "").strip()
		if not linked_server:
			frappe.throw("Please select a Server before deploying.")
		if not frappe.db.exists("Server", linked_server):
			frappe.throw(f"Linked Server '{linked_server}' does not exist.")
		server = frappe.get_cached_doc("Server", linked_server)
		if getattr(server, "verify_status", "Not Verified") != "Prepared":
			frappe.throw("Server is not verified. Please verify the server first.")
		return server

	def validate_custom_image_constraints(self):
		if not self.is_custom:
			return

		if not self.custom_image:
			frappe.throw("Please select a Custom Image when 'Is Custom' is enabled.")

		custom = frappe.get_cached_doc("Custom Image", self.custom_image)
		custom_status = (custom.get("build_status") or "").strip()
		custom_server = (custom.get("server_name") or "").strip()
		site_server = (self.server_name or "").strip()

		if custom_status != "Built":
			frappe.throw(
				f"Custom Image '{custom.name}' is not built yet. Current status: {custom_status or 'Unknown'}."
			)

		if not (custom.get("image_tag") or "").strip():
			frappe.throw(f"Custom Image '{custom.name}' has no image tag. Build it again before deploying.")

		if site_server and custom_server and site_server != custom_server:
			frappe.throw(
				"Custom image deployment requires the image and site to be on the same server. "
				f"Selected image is on '{custom_server}', but this site is on '{site_server}'. "
				"Choose a custom image built on this server, or deploy this site to the image server."
			)

		# Validate that site's apps match custom image's built apps
		self._validate_apps_match_custom_image(custom)

	def _validate_apps_match_custom_image(self, custom):
		"""Ensure every app the site wants to install is present in the custom image.

		A site may install a *subset* of the apps built into the image — that is the
		intended workflow (one image, many sites with different app combinations).
		We only error when the site references an app that is NOT in the image at all.
		"""
		# Build the set of module names available in the custom image
		custom_image_apps = set()
		for app_item in custom.apps_config or []:
			if app_item.get("app_name"):
				try:
					app_doc = frappe.get_cached_doc("Apps", app_item.get("app_name"))
					module_name = app_doc.get("module_name") or app_doc.get("scrubbed_name")
					if module_name:
						custom_image_apps.add(module_name)
				except frappe.DoesNotExistError:
					frappe.throw(
						f"App '{app_item.get('app_name')}' referenced in custom image '{custom.name}' "
						"was not found in Apps doctype."
					)

		# Build the set of module names the site wants to install
		site_apps = set()
		for app_item in self.get("install_apps") or []:
			if app_item.get("app_name"):
				app_name = app_item.get("app_name")
				try:
					app_doc = frappe.get_cached_doc("Apps", app_name)
					module_name = app_doc.get("module_name") or app_doc.get("scrubbed_name")
					if not module_name:
						frappe.throw(
							f"App '{app_name}' has no module_name configured and cannot be imported. "
							"Please contact your administrator."
						)
					site_apps.add(module_name)
				except frappe.DoesNotExistError:
					frappe.throw(f"App '{app_name}' referenced in site but not found in Apps doctype.")

		# Subset check: every site app must exist in the image
		if custom_image_apps and site_apps:
			missing_in_image = site_apps - custom_image_apps
			if missing_in_image:
				frappe.throw(
					f"The following apps are configured for this site but are NOT built into "
					f"custom image '{custom.name}': {', '.join(sorted(missing_in_image))}.\n\n"
					"Either remove those apps from the site, add them to the custom image and rebuild it, "
					"or select a different image that includes them."
				)

	def _ensure_password(self):
		if not self.admin_password:
			self.admin_password = random_string(10)

		if not self.db_password:
			self.db_password = random_string(10)

	def _sync_apps_from_custom_image(self):
		"""When the custom image changes, retain only apps that are present in the new image.

		Apps that are no longer available in the newly selected image are removed from
		install_apps. Apps that are still available are kept so the user doesn't have
		to re-select them. The user can then pick additional apps via "Install App".
		"""
		custom = frappe.get_cached_doc("Custom Image", self.custom_image)

		# Build the set of Apps doctype names available in the new image
		image_app_names = set()
		for row in custom.apps_config or []:
			if row.app_name:
				image_app_names.add(row.app_name)

		# Keep only install_apps rows whose app_name is present in the image
		kept = [
			{"app_name": row.app_name}
			for row in (self.get("install_apps") or [])
			if (row.app_name or "").strip() in image_app_names
		]
		self.set("install_apps", kept)

	def _requires_reprepare(self) -> bool:
		"""Return True when deployment-impacting config changes after initial save."""
		if self.is_new():
			return False

		deployment_fields = (
			"server_name",
			"bench_name",
			"site_url",
			"ssl_enabled",
			"is_custom",
			"custom_image",
			"docker_image",
			"admin_password",
			"db_username",
			"db_password",
			"install_apps",
		)

		return any(self.has_value_changed(fieldname) for fieldname in deployment_fields)

	def get_docker_image(self) -> str:
		"""Resolve the Docker image to use for deployment
		Returns the appropriate Docker image based on is_custom flag"""
		if self.is_custom and self.custom_image:
			custom_img = frappe.get_cached_doc("Custom Image", self.custom_image)

			if custom_img.image_tag:
				return custom_img.image_tag

		return self.docker_image

	def get_deployment_vars(self) -> dict:
		"""Prepare all variables needed for deployment"""

		install_apps = []
		for row in self.get("install_apps"):
			if row.app_name:
				app_doc = frappe.get_cached_doc("Apps", row.app_name)
				# Use module_name (actual Python module from repo) if available,
				# otherwise fall back to scrubbed_name for backwards compatibility
				module_name = app_doc.get("module_name") or app_doc.get("scrubbed_name")
				if module_name:
					install_apps.append(module_name)

		install_apps_csv = ",".join(install_apps)  # empty means frappe-only; no default app forced

		docker_image = self.get_docker_image()
		return {
			"ssl_enabled": int(self.ssl_enabled or 0),
			"docker_image": docker_image,
			"site_url": self.site_url or "",
			"install_apps_csv": install_apps_csv,
			"admin_password": self.get_password("admin_password") or "admin",
			"db_username": self.db_username or "root",
			"db_password": self.get_password("db_password") or "admin",
			"bench_name": self.bench_name or "",
		}

	def _generate_site_url(self, bench_name: str) -> str:
		"""Generate a traefik.me domain for the site based on bench name and server IP.

		Args:
			bench_name: The bench name to use for the URL prefix

		Returns:
			str: Generated site URL in format: {bench_name}.{server_ip}.traefik.me
		"""
		server = frappe.get_cached_doc("Server", self.server_name)
		site_prefix = bench_name.lower()
		return f"{site_prefix}.{server.server_ip}.traefik.me"

	def _extract_task_stdout(self, result: dict, task_name: str) -> str:
		raw_json = result.get("data", {}).get("raw_json") or result.get("raw_json") or {}
		for play in raw_json.get("plays", []):
			for task in play.get("tasks", []):
				task_info = task.get("task", {})
				if task_info.get("name") != task_name:
					continue
				hosts_data = task.get("hosts", {})
				for _host, host_result in hosts_data.items():
					stdout = host_result.get("stdout", "")
					if stdout:
						return stdout.strip()
		return ""

	def _extract_task_host_result(self, result: dict, task_name: str) -> dict[str, Any]:
		raw_json = result.get("data", {}).get("raw_json") or result.get("raw_json") or {}
		for play in raw_json.get("plays", []):
			for task in play.get("tasks", []):
				task_info = task.get("task", {})
				if task_info.get("name") != task_name:
					continue
				hosts_data = task.get("hosts", {})
				for _host, host_result in hosts_data.items():
					return host_result
		return {}

	def _extract_playbook_failure_detail(self, result: dict) -> str:
		"""Return a concise failure detail extracted from Ansible raw JSON output."""
		raw_json = result.get("data", {}).get("raw_json") or result.get("raw_json") or {}
		last_detail = ""

		for play in raw_json.get("plays", []):
			for task in play.get("tasks", []):
				task_name = (task.get("task", {}) or {}).get("name") or "Unnamed task"
				for _host, host_result in (task.get("hosts", {}) or {}).items():
					is_failed = bool(host_result.get("failed")) or bool(host_result.get("unreachable"))
					if not is_failed:
						continue

					detail = (
						_event_text(host_result.get("msg"))
						or _event_text(host_result.get("stderr"))
						or _event_text(host_result.get("stdout"))
					)
					if not detail:
						continue

					detail = detail.strip()
					if len(detail) > 900:
						detail = detail[-900:]
					last_detail = f"{task_name}: {detail}"

		return last_detail

	def _remote_backup_root(self) -> str:
		bench_name = (self.bench_name or self.name or "").strip()
		return f"/home/{bench_name}/Backups"

	def _absolute_site_path(self, *parts: str) -> str:
		"""Resolve site-relative paths to absolute filesystem paths.

		Some runtimes return frappe.get_site_path() as ./<site>/..., which breaks
		Ansible fetch destinations because they are resolved relative to playbook cwd.
		"""
		path = frappe.get_site_path(*parts)
		if os.path.isabs(path):
			return os.path.normpath(path)
		normalized = path[2:] if path.startswith("./") else path
		return os.path.normpath(os.path.join(frappe.utils.get_bench_path(), "sites", normalized))

	def _local_backup_download_dir(self, backup_label: str) -> str:
		return self._absolute_site_path("private", "files", "nano_press_backups", self.name, backup_label)

	def _backup_catalog_root(self) -> str:
		return os.path.normpath(f"{self._remote_backup_root()}/{self.site_url or 'frontend'}")

	def _normalize_backup_directory(self, backup_directory: str) -> str:
		candidate = os.path.normpath((backup_directory or "").strip())
		if not candidate:
			frappe.throw("Backup directory is required.")

		root = self._backup_catalog_root()
		if candidate == root:
			frappe.throw("Choose a specific backup directory, not the backup root.")
		if not candidate.startswith(root + os.sep):
			frappe.throw("Invalid backup directory path.")
		return candidate

	def _infer_backup_kind(self, file_name: str) -> str:
		name = (file_name or "").lower()
		if "-database.sql.gz" in name:
			return "database"
		if "-private-files" in name:
			return "private"
		if "-files" in name:
			return "public"
		return "backup"

	def _private_file_url_from_path(self, absolute_path: str) -> str:
		private_files_root = self._absolute_site_path("private", "files")
		normalized = os.path.normpath(absolute_path)
		if normalized != private_files_root and not normalized.startswith(private_files_root + os.sep):
			frappe.throw("Backup download file path is outside the private files directory.")

		relative = os.path.relpath(normalized, private_files_root).replace(os.sep, "/")
		return f"/private/files/{relative}"

	def _create_downloadable_backup_file(
		self,
		*,
		absolute_path: str,
		backup_label: str,
		kind: str,
	) -> dict[str, str]:
		label_map = {
			"database": "Database Backup",
			"public": "Public Files Backup",
			"private": "Private Files Backup",
		}
		file_name = os.path.basename(absolute_path)
		file_url = self._private_file_url_from_path(absolute_path)
		existing_name = frappe.db.get_value(
			"File",
			{
				"attached_to_doctype": "Frappe Site",
				"attached_to_name": self.name,
				"file_url": file_url,
			},
			"name",
		)

		if existing_name:
			file_doc = frappe.get_doc("File", existing_name)
		else:
			file_doc = frappe.get_doc(
				{
					"doctype": "File",
					"file_name": file_name,
					"file_url": file_url,
					"is_private": 1,
					"attached_to_doctype": "Frappe Site",
					"attached_to_name": self.name,
				}
			)
			file_doc.insert(ignore_permissions=True)

		return {
			"kind": kind,
			"label": label_map.get(kind, kind.title()),
			"file_name": file_doc.file_name,
			"file_url": file_doc.file_url,
			"file_doc": file_doc.name,
			"backup_label": backup_label,
		}

	def _resolve_uploaded_backup_file(self, file_url: str) -> dict[str, str]:
		if not file_url:
			frappe.throw("Restore upload is missing a file.")

		file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
		if file_name:
			file_doc = frappe.get_doc("File", file_name)
			absolute_path = file_doc.get_full_path()
			resolved_url = file_doc.file_url
			resolved_name = file_doc.file_name
		else:
			resolved_url = file_url
			if file_url.startswith("/private/files/"):
				absolute_path = frappe.get_site_path(
					"private", "files", *file_url.split("/private/files/", 1)[1].split("/")
				)
			elif file_url.startswith("/files/"):
				absolute_path = frappe.get_site_path(
					"public", "files", *file_url.split("/files/", 1)[1].split("/")
				)
			else:
				frappe.throw(f"Unsupported uploaded file path: {file_url}")
			resolved_name = os.path.basename(absolute_path)

		if not os.path.exists(absolute_path):
			frappe.throw(f"Uploaded restore file not found on disk: {resolved_name}")

		return {
			"file_url": resolved_url,
			"file_name": resolved_name,
			"absolute_path": absolute_path,
		}

	def _register_backup_downloads(
		self,
		*,
		backup_label: str,
		controller_download_dir: str,
		manifest: dict[str, Any],
	) -> list[dict[str, str]]:
		registered_files = []
		for item in manifest.get("files") or []:
			local_path = os.path.join(controller_download_dir, item.get("name") or "")
			if not item.get("name") or not os.path.exists(local_path):
				continue
			registered_files.append(
				self._create_downloadable_backup_file(
					absolute_path=local_path,
					backup_label=backup_label,
					kind=(item.get("kind") or "backup"),
				)
			)
		return registered_files

	def _get_runtime_state(self) -> dict:
		result = run_playbook(
			server_name=self.server_name,
			playbook_path="site_runtime_status.yml",
			extra_vars={
				"bench_name": self.bench_name,
				"site_url": (self.site_url or "").strip(),
			},
			timeout=120,
		)

		stdout = self._extract_task_stdout(result, "Collect site runtime status")
		if not stdout:
			return {"exists": False, "running": False, "containers_running": 0, "ok": False}

		try:
			parsed = json.loads(stdout)
		except Exception:
			return {"exists": False, "running": False, "containers_running": 0, "ok": False}

		return {
			"exists": bool(parsed.get("exists")),
			"running": bool(parsed.get("running")),
			"containers_running": int(parsed.get("containers_running") or 0),
			"http_ok": bool(parsed.get("http_ok")),
			"ok": True,
		}

	def _sync_status_from_runtime(self) -> dict:
		runtime = self._get_runtime_state()
		if not runtime.get("ok"):
			return {"status": self.status, "changed": False, "runtime": runtime}

		new_status = self.status

		if runtime.get("running"):
			new_status = "Deployed"
		elif runtime.get("exists"):
			# Containers exist but not running — only mark Stopped from a stable running state
			if self.status in {"Deployed", "Failed"}:
				new_status = "Stopped"
		elif self.status in {"Deployed", "Stopped", "Not Deployed", "Failed"}:
			# No containers at all — reset to Not Deployed for stable/failed states, never
			# overwrite an in-progress status (Deploying, Ready To Deploy)
			new_status = "Not Deployed"

		changed = new_status != self.status
		if changed:
			self.flags.skip_reprepare_reset = True
			self.status = new_status
			self.save(ignore_permissions=True)

		return {"status": new_status, "changed": changed, "runtime": runtime}

	@frappe.whitelist()
	def sync_runtime_status(self) -> dict:
		self.validate_server()
		return self._sync_status_from_runtime()

	@frappe.whitelist()
	def get_runtime_progress(self) -> dict:
		"""Return raw runtime state for progress UI without mutating site status."""
		self.validate_server()
		return {"runtime": self._get_runtime_state()}

	@frappe.whitelist()
	def prepare_for_deployment(self) -> dict:
		self.validate_server()
		self.validate_custom_image_constraints()
		deployment_vars = self.get_deployment_vars()
		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		self.status = "Deploying"
		self.save()

		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_prepare_deployment_background",
			queue="long",
			timeout=3600,
			deployment_vars=deployment_vars,
			requested_by=requested_by,
		)

		frappe.publish_realtime(
			"nano_press:progress",
			{
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": "Queued",
				"percent": 5,
				"status": "running",
				"queued_at": queued_at,
				"message": "Job queued, waiting for worker...",
			},
			user=requested_by,
		)

		return {
			"status": "queued",
			"queued_at": queued_at,
			"message": "Deployment preparation started in background.",
		}

	def _prepare_deployment_background(self, deployment_vars: dict, requested_by: str | None = None):
		_user = requested_by or "Administrator"
		prepare_repo_total = _count_playbook_tasks("prepare_repo.yml")
		render_pwd_total = _count_playbook_tasks("render_pwd.yml")
		prepare_repo_index = 0
		render_pwd_index = 0

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": self.name,
					"doc_type": "Frappe Site",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_prepare_repo_event(event: dict):
			nonlocal prepare_repo_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			if event.get("event") == "task_start":
				prepare_repo_index += 1
				percent = min(50, max(18, round((prepare_repo_index / prepare_repo_total) * 48)))
				emit(
					"Preparing repository",
					percent,
					"running",
					f"Executing: {task_name}",
					task_name=task_name,
					task_state="running",
					task_index=prepare_repo_index,
					task_total=prepare_repo_total,
				)
				return

			if event.get("event") == "task_result":
				task_state = event.get("status") or "success"
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					"Preparing repository",
					min(50, max(18, round((max(prepare_repo_index, 1) / prepare_repo_total) * 48))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=prepare_repo_index,
					task_total=prepare_repo_total,
				)

		def handle_render_pwd_event(event: dict):
			nonlocal render_pwd_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			if event.get("event") == "task_start":
				render_pwd_index += 1
				percent = min(95, max(58, round(55 + (render_pwd_index / render_pwd_total) * 40)))
				emit(
					"Rendering compose file",
					percent,
					"running",
					f"Executing: {task_name}",
					task_name=task_name,
					task_state="running",
					task_index=render_pwd_index,
					task_total=render_pwd_total,
				)
				return

			if event.get("event") == "task_result":
				task_state = event.get("status") or "success"
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					"Rendering compose file",
					min(95, max(58, round(55 + (max(render_pwd_index, 1) / render_pwd_total) * 40))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=render_pwd_index,
					task_total=render_pwd_total,
				)

		try:
			emit("Preparing repository", 20, "running", "Running prepare_repo.yml on the server...")
			result1 = run_playbook(
				server_name=self.server_name,
				playbook_path="prepare_repo.yml",
				extra_vars={"bench_name": self.bench_name},
				event_handler=handle_prepare_repo_event,
			)
			if result1.get("status") != "success":
				raise Exception(f"prepare_repo.yml failed: {result1.get('message', 'Unknown error')}")

			emit("Rendering compose file", 60, "running", "Running render_pwd.yml on the server...")
			result2 = run_playbook(
				server_name=self.server_name,
				playbook_path="render_pwd.yml",
				extra_vars=deployment_vars,
				event_handler=handle_render_pwd_event,
			)
			if result2.get("status") != "success":
				raise Exception(f"render_pwd.yml failed: {result2.get('message', 'Unknown error')}")

			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Ready To Deploy"
			self.last_deployed_at = frappe.utils.now_datetime()
			self.save()

			emit("Complete", 100, "success", "Deployment preparation complete! You can now deploy the site.")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "prepare_for_deployment failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save()
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	@frappe.whitelist()
	def deploy_site(self, force_redeploy: int | bool = 0) -> dict:
		self.validate_server()
		self.validate_custom_image_constraints()
		runtime = self._get_runtime_state()
		is_running = runtime.get("ok") and runtime.get("running")
		force = bool(frappe.utils.cint(force_redeploy))

		if is_running and not force:
			self.flags.skip_reprepare_reset = True
			self.status = "Deployed"
			self.save(ignore_permissions=True)
			return {
				"status": "already_running",
				"message": "Site is already running.",
				"runtime": runtime,
			}

		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		self.flags.skip_reprepare_reset = True
		self.status = "Deploying"
		self.save()

		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_deploy_site_background",
			queue="long",
			timeout=3600,
			requested_by=requested_by,
		)

		frappe.publish_realtime(
			"nano_press:progress",
			{
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": "Deploying site",
				"percent": 5,
				"status": "running",
				"queued_at": queued_at,
				"message": "Deployment queued, waiting for worker...",
			},
			user=requested_by,
		)

		return {
			"status": "queued",
			"queued_at": queued_at,
			"message": "Site deployment started in background.",
		}

	def _deploy_site_background(self, requested_by: str | None = None):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("compose_up.yml")
		task_index = 0

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": self.name,
					"doc_type": "Frappe Site",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_compose_up_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			name_l = task_name.lower()
			step = "Deploying containers"
			if (
				"create-site" in name_l
				or "installation" in name_l
				or "install" in name_l
				or "probe create-site" in name_l
			):
				step = "Installing apps"

			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(12, round((task_index / task_total) * 92)))
				emit(
					step,
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					step,
					min(95, max(12, round((max(task_index, 1) / task_total) * 92))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			emit("Deploying site", 10, "running", "Worker picked up deployment job.")

			result = run_playbook(
				server_name=self.server_name,
				playbook_path="compose_up.yml",
				extra_vars={"bench_name": self.bench_name},
				event_handler=handle_compose_up_event,
			)
			if result.get("status") != "success":
				raise Exception(f"compose_up.yml failed: {result.get('message', 'Unknown error')}")

			# Track real startup progress from running core containers, then
			# require consecutive HTTP successes before marking the deployment done.
			expected_core_containers = 9
			http_success_streak = 0
			deadline = time.time() + 240
			while time.time() < deadline:
				runtime = self._get_runtime_state()

				if not runtime.get("ok"):
					emit(
						"Deploying containers",
						15,
						"running",
						"Collecting container runtime status...",
					)
					time.sleep(5)
					continue

				running_count = max(0, int(runtime.get("containers_running") or 0))
				container_percent = min(90, running_count * 10)

				if running_count < expected_core_containers:
					http_success_streak = 0
					emit(
						"Deploying containers",
						max(20, container_percent),
						"running",
						f"{running_count}/{expected_core_containers} core containers are running.",
					)
					time.sleep(5)
					continue

				if runtime.get("http_ok"):
					http_success_streak += 1
				else:
					http_success_streak = 0

				if http_success_streak >= 3:
					break

				readiness_percent = min(99, 90 + (http_success_streak * 3))
				emit(
					"Checking site response",
					readiness_percent,
					"running",
					f"Core containers are up. Verifying login/API response ({http_success_streak}/3).",
				)
				time.sleep(5)

			if http_success_streak < 3:
				raise Exception(
					"Containers started but site did not return stable HTTP responses in time. Please check logs."
				)

			resolved_image = (self.get_docker_image() or "").strip()
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Deployed"
			if resolved_image:
				self.docker_image = resolved_image
			self.last_deployed_at = frappe.utils.now_datetime()
			self.save()
			emit("Complete", 100, "success", "Site is healthy. Deployment completed successfully.")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "deploy_site failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save()
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	@frappe.whitelist()
	def stop_site(self) -> dict:
		self.validate_server()
		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_stop_site_background",
			queue="long",
			timeout=900,
			requested_by=requested_by,
		)
		frappe.publish_realtime(
			"nano_press:progress",
			{
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": "Stopping containers",
				"percent": 5,
				"status": "running",
				"queued_at": queued_at,
				"message": "Job queued, waiting for worker...",
			},
			user=requested_by,
		)
		return {
			"status": "queued",
			"queued_at": queued_at,
			"message": "Stop operation started in background.",
		}

	def _stop_site_background(self, requested_by: str | None = None):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("stop_all_containers.yml")
		task_index = 0
		expected_core_containers = 9

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": self.name,
					"doc_type": "Frappe Site",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return
			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(12, round((task_index / task_total) * 92)))
				emit(
					"Stopping containers",
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					"Stopping containers",
					min(95, max(12, round((max(task_index, 1) / task_total) * 92))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			emit("Stopping containers", 10, "running", "Worker picked up stop job.")
			result = run_playbook(
				server_name=self.server_name,
				playbook_path="stop_all_containers.yml",
				extra_vars={"bench_name": self.bench_name},
				event_handler=handle_event,
			)
			if result.get("status") != "success":
				raise Exception(f"stop_all_containers.yml failed: {result.get('message', 'Unknown error')}")

			deadline = time.time() + 45
			while time.time() < deadline:
				runtime = self._get_runtime_state()
				remaining = max(0, int(runtime.get("containers_running") or 0))
				if remaining == 0:
					break

				emit(
					"Stopping containers",
					max(15, min(95, round(((expected_core_containers - remaining) / expected_core_containers) * 95))),
					"running",
					f"Waiting for containers to stop ({remaining}/{expected_core_containers} still running).",
				)
				time.sleep(3)

			if runtime.get("containers_running"):
				raise Exception(
					f"Stop completed but {runtime.get('containers_running')} containers are still running."
				)

			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Stopped"
			self.save()
			emit("Complete", 100, "success", "All containers stopped successfully.")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "stop_site failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save()
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	@frappe.whitelist()
	def remove_site(self) -> dict:
		self.validate_server()
		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_remove_site_background",
			queue="long",
			timeout=900,
			requested_by=requested_by,
		)
		frappe.publish_realtime(
			"nano_press:progress",
			{
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": "Destroying site",
				"percent": 5,
				"status": "running",
				"queued_at": queued_at,
				"message": "Job queued, waiting for worker...",
			},
			user=requested_by,
		)
		return {
			"status": "queued",
			"queued_at": queued_at,
			"message": "Destroy operation started in background.",
		}

	def _remove_site_background(self, requested_by: str | None = None):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("destroy_site.yml")
		task_index = 0
		expected_core_containers = 9

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": self.name,
					"doc_type": "Frappe Site",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return
			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(12, round((task_index / task_total) * 92)))
				emit(
					"Destroying site",
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					"Destroying site",
					min(95, max(12, round((max(task_index, 1) / task_total) * 92))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			emit("Destroying site", 10, "running", "Worker picked up destroy job.")
			result = run_playbook(
				server_name=self.server_name,
				playbook_path="destroy_site.yml",
				extra_vars={"bench_name": self.bench_name},
				event_handler=handle_event,
			)
			if result.get("status") != "success":
				# Destroy is idempotent: if runtime already shows no containers,
				# treat this as success instead of a false failure.
				runtime_after_error = self._get_runtime_state()
				remaining_after_error = max(0, int(runtime_after_error.get("containers_running") or 0))
				if remaining_after_error > 0:
					raise Exception(f"destroy_site.yml failed: {result.get('message', 'Unknown error')}")
				emit(
					"Destroying site",
					95,
					"running",
					"Destroy playbook reported an error, but containers are already removed. Finalizing status...",
				)

			deadline = time.time() + 60
			while time.time() < deadline:
				runtime = self._get_runtime_state()
				remaining = max(0, int(runtime.get("containers_running") or 0))
				if remaining == 0:
					break

				emit(
					"Destroying site",
					max(15, min(95, round(((expected_core_containers - remaining) / expected_core_containers) * 95))),
					"running",
					f"Waiting for containers to be removed ({remaining}/{expected_core_containers} still running).",
				)
				time.sleep(3)

			if runtime.get("containers_running"):
				raise Exception(
					f"Destroy completed but {runtime.get('containers_running')} containers are still running."
				)

			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Not Deployed"
			self.save()
			emit("Complete", 100, "success", "Site destroyed successfully.")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "remove_site failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save()
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	@frappe.whitelist()
	def restart_site(self) -> dict:
		self.validate_server()
		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_restart_site_background",
			queue="long",
			timeout=900,
			requested_by=requested_by,
		)
		frappe.publish_realtime(
			"nano_press:progress",
			{
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": "Restarting containers",
				"percent": 5,
				"status": "running",
				"queued_at": queued_at,
				"message": "Job queued, waiting for worker...",
			},
			user=requested_by,
		)
		return {
			"status": "queued",
			"queued_at": queued_at,
			"message": "Restart operation started in background.",
		}

	def _restart_site_background(self, requested_by: str | None = None):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("restart_site.yml")
		task_index = 0

		def emit(step, percent, status, message, **extra):
			frappe.publish_realtime(
				"nano_press:progress",
				{
					"doc_name": self.name,
					"doc_type": "Frappe Site",
					"step": step,
					"percent": percent,
					"status": status,
					"message": message,
					**extra,
				},
				user=_user,
			)

		def handle_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return
			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(12, round((task_index / task_total) * 92)))
				emit(
					"Restarting containers",
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					"Restarting containers",
					min(95, max(12, round((max(task_index, 1) / task_total) * 92))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			result = run_playbook(
				server_name=self.server_name,
				playbook_path="restart_site.yml",
				extra_vars={"bench_name": self.bench_name},
				event_handler=handle_event,
			)
			if result.get("status") != "success":
				raise Exception(f"restart_site.yml failed: {result.get('message', 'Unknown error')}")

			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Deployed"
			self.last_deployed_at = frappe.utils.now_datetime()
			self.save()
			emit("Complete", 100, "success", "Containers restarted successfully.")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "restart_site failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save()
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	def _resolve_app_slug(self, app_name: str) -> tuple[str, str]:
		if not app_name:
			frappe.throw("Please select an app.")

		app_name = app_name.strip()
		if not app_name:
			frappe.throw("Please select an app.")

		if frappe.db.exists("Apps", app_name):
			app_doc = frappe.get_cached_doc("Apps", app_name)
			app_slug = (app_doc.get("module_name") or app_doc.scrubbed_name or "").strip() or app_name
			return app_name, app_slug

		# Allow runtime app slugs (e.g. `hrms`) by mapping them back to the Apps doctype
		# record name (e.g. `hrms-version-16`) via module_name/scrubbed_name.
		mapped = frappe.db.get_value("Apps", {"module_name": app_name}, "name")
		if not mapped:
			mapped = frappe.db.get_value("Apps", {"scrubbed_name": app_name}, "name")
		if mapped and frappe.db.exists("Apps", mapped):
			app_doc = frappe.get_cached_doc("Apps", mapped)
			app_slug = (app_doc.get("module_name") or app_doc.scrubbed_name or "").strip() or app_name
			return mapped, app_slug

		return app_name, app_name

	def _assert_install_allowed_by_subscription(self, app_name: str):
		sub_name = (self.active_subscription or "").strip()
		if not sub_name or not frappe.db.exists("Site Subscription", sub_name):
			return

		sub = frappe.get_doc("Site Subscription", sub_name)
		if (sub.status or "").strip() not in {"Active", "Grace", "Suspended"}:
			return

		allowed_apps = set()
		if sub.plan and frappe.db.exists("Hosting Plan", sub.plan):
			plan = frappe.get_cached_doc("Hosting Plan", sub.plan)
			for row in plan.get("included_apps") or []:
				if (row.app_name or "").strip() and int(row.is_included or 0):
					allowed_apps.add((row.app_name or "").strip())

		addon_apps = set()
		for row in sub.get("addons") or []:
			if (row.app_name or "").strip() and int(row.enabled or 0):
				addon_apps.add((row.app_name or "").strip())

		if app_name in allowed_apps or app_name in addon_apps:
			return

		frappe.throw(
			f"App '{app_name}' is not included in the assigned plan or enabled addons for this site. "
			"Please update the subscription before installing this app."
		)

	def _assert_custom_image_deployed(self):
		"""Ensure custom site is running the selected built custom image tag.

		Without this, install options may come from Custom Image config while runtime
		containers still use an older/base docker image, causing install failures.
		"""
		if not (self.is_custom and self.custom_image):
			return

		if not frappe.db.exists("Custom Image", self.custom_image):
			return

		custom = frappe.get_cached_doc("Custom Image", self.custom_image)
		tag = (custom.get("image_tag") or "").strip()
		if not tag:
			frappe.throw("Selected custom image is not built yet. Build and deploy it before installing apps.")

		current_image = (self.docker_image or "").strip()
		if current_image != tag:
			frappe.throw(
				"This site is not running the selected custom image yet. "
				f"Current image: '{current_image or 'not set'}', expected: '{tag}'. "
				"Please redeploy the site with this custom image, then retry app installation."
			)

	def _get_install_row_billing_meta(self, app_name: str) -> dict:
		meta = {
			"source_type": "Manual Override",
			"monthly_charge": 0,
			"is_allowed_by_plan": 1,
		}

		sub_name = (self.active_subscription or "").strip()
		if not sub_name or not frappe.db.exists("Site Subscription", sub_name):
			return meta

		sub = frappe.get_doc("Site Subscription", sub_name)
		if sub.plan and frappe.db.exists("Hosting Plan", sub.plan):
			plan = frappe.get_cached_doc("Hosting Plan", sub.plan)
			for row in plan.get("included_apps") or []:
				if (row.app_name or "").strip() == app_name and int(row.is_included or 0):
					meta["source_type"] = "Included Plan"
					meta["monthly_charge"] = 0
					return meta

		for row in sub.get("addons") or []:
			if (row.app_name or "").strip() == app_name and int(row.enabled or 0):
				meta["source_type"] = "Paid Addon"
				meta["monthly_charge"] = row.monthly_price or 0
				return meta

		return meta

	def _queue_site_app_action(self, *, action: str, app_name: str) -> dict:
		self.validate_server()
		if action not in {"install", "uninstall"}:
			frappe.throw("Invalid app action.")

		runtime = self._get_runtime_state()
		if not (runtime.get("ok") and runtime.get("running")):
			frappe.throw("Site containers are not running. Start containers before managing apps.")

		app_label, app_slug = self._resolve_app_slug(app_name)
		if action == "install":
			self._assert_custom_image_deployed()
			self._assert_install_allowed_by_subscription(app_label)
		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		run_id = frappe.generate_hash(length=12)

		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_site_app_action_background",
			queue="long",
			timeout=3600,
			action=action,
			run_id=run_id,
			app_label=app_label,
			app_slug=app_slug,
			requested_by=requested_by,
		)

		action_text = "Installing app" if action == "install" else "Uninstalling app"
		payload = {
			"doc_name": self.name,
			"doc_type": "Frappe Site",
			"step": action_text,
			"percent": 5,
			"status": "running",
			"queued_at": queued_at,
			"run_id": run_id,
			"message": f"{action_text} '{app_slug}' queued, waiting for worker...",
		}
		frappe.publish_realtime("nano_press:progress", payload, user=requested_by)
		_set_site_action_progress(self.name, action, run_id, payload)
		frappe.cache().set_value(
			f"nano_press:action_last_update:{self.name}:{action}:{run_id}",
			str(time.time()),
			expires_in_sec=7200,
		)

		return {
			"status": "queued",
			"queued_at": queued_at,
			"run_id": run_id,
			"message": f"{action_text} started in background.",
			"app_name": app_label,
			"app_slug": app_slug,
		}

	@frappe.whitelist()
	def get_installed_apps(self) -> list[str]:
		"""Return the list of apps currently installed on the live site via bench list-apps."""
		result = run_playbook(
			server_name=self.server_name,
			playbook_path="list_site_apps.yml",
			extra_vars={
				"bench_name": self.bench_name,
				"site_name": self.site_url or "frontend",
			},
			timeout=60,
		)
		stdout = self._extract_task_stdout(result, "List installed apps on site")
		apps = [line.strip() for line in stdout.splitlines() if line.strip()]
		return apps

	@frappe.whitelist()
	def install_site_app(self, app_name: str) -> dict:
		return self._queue_site_app_action(action="install", app_name=app_name)

	@frappe.whitelist()
	def uninstall_site_app(self, app_name: str) -> dict:
		return self._queue_site_app_action(action="uninstall", app_name=app_name)

	@frappe.whitelist()
	def get_image_available_apps(self) -> list[dict]:
		"""Return apps that are in the custom image but not yet installed on this site.

		Each entry has:
		  - app_name: the Apps doctype name (used as the install identifier)
		  - label: human-friendly display name
		"""
		if not (self.is_custom and self.custom_image):
			return []

		self._assert_custom_image_deployed()

		try:
			custom = frappe.get_cached_doc("Custom Image", self.custom_image)
		except frappe.DoesNotExistError:
			return []

		# Prefer live runtime apps to avoid stale rows in install_apps after manual/runtime actions.
		installed_slugs: set[str] = set()
		try:
			installed_slugs = {app.strip() for app in self.get_installed_apps() if app and app.strip()}
		except Exception:
			installed_slugs = set()

		# Fallback for environments where runtime probe is unavailable.
		installed_labels = {(row.app_name or "").strip() for row in (self.get("install_apps") or [])}

		available = []
		for row in custom.apps_config or []:
			app_name = (row.app_name or "").strip()
			if not app_name:
				continue

			# Skip if already installed according to live app slugs.
			if installed_slugs:
				try:
					app_doc = frappe.get_cached_doc("Apps", app_name)
				except frappe.DoesNotExistError:
					app_doc = None
				app_slug = (
					(app_doc.get("module_name") if app_doc else "")
					or (app_doc.scrubbed_name if app_doc else "")
					or app_name
				).strip()
				if app_slug in installed_slugs:
					continue
			elif app_name in installed_labels:
				continue

			label = app_name
			try:
				app_doc = frappe.get_cached_doc("Apps", app_name)
				label = app_doc.get("app_name") or app_name
			except frappe.DoesNotExistError:
				pass
			available.append({"app_name": app_name, "label": label})

		return available

	def _site_app_action_background(
		self,
		action: str,
		app_label: str,
		app_slug: str,
		requested_by: str | None = None,
		run_id: str | None = None,
	):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("manage_site_app.yml")
		task_index = 0
		action_text = "Installing app" if action == "install" else "Uninstalling app"

		def emit(step, percent, status, message, **extra):
			payload = {
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": step,
				"percent": percent,
				"status": status,
				"message": message,
				"run_id": run_id,
				**extra,
			}
			frappe.publish_realtime("nano_press:progress", payload, user=_user)
			if run_id:
				_set_site_action_progress(self.name, action, run_id, payload)
				frappe.cache().set_value(
					f"nano_press:action_last_update:{self.name}:{action}:{run_id}",
					str(time.time()),
					expires_in_sec=7200,
				)

		def task_step(task_name: str) -> str:
			name_l = task_name.lower()
			if (
				"wait for app operation" in name_l
				or "probe app operation" in name_l
				or "live app operation logs" in name_l
			):
				return "Running app command"
			if "start app operation" in name_l:
				return "Starting app command"
			return "Preparing app operation"

		def handle_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			step = task_step(task_name)

			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(10, round((task_index / task_total) * 90)))
				emit(
					step,
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					step,
					min(95, max(10, round((max(task_index, 1) / task_total) * 90))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			result = run_playbook(
				server_name=self.server_name,
				playbook_path="manage_site_app.yml",
				extra_vars={
					"bench_name": self.bench_name,
					"site_name": self.site_url or "frontend",
					"app_action": action,
					"app_name": app_slug,
				},
				event_handler=handle_event,
			)
			if result.get("status") != "success":
				detail = self._extract_playbook_failure_detail(result)
				message = detail or result.get("message", "Unknown error")
				raise Exception(f"manage_site_app.yml failed: {message}")

			if frappe.db.exists("Apps", app_label):
				if action == "install":
					exists = any(
						(row.app_name or "").strip() == app_label for row in self.get("install_apps") or []
					)
					if not exists:
						meta = self._get_install_row_billing_meta(app_label)
						self.append(
							"install_apps",
							{
								"app_name": app_label,
								"source_type": meta.get("source_type"),
								"monthly_charge": meta.get("monthly_charge"),
								"is_allowed_by_plan": meta.get("is_allowed_by_plan", 1),
							},
						)
				else:
					remaining = []
					for row in self.get("install_apps") or []:
						if (row.app_name or "").strip() != app_label:
							remaining.append({"app_name": row.app_name})
					self.set("install_apps", remaining)

			self.reload()
			# Re-apply install_apps mutation after reload
			if frappe.db.exists("Apps", app_label):
				if action == "install":
					exists = any(
						(row.app_name or "").strip() == app_label for row in self.get("install_apps") or []
					)
					if not exists:
						meta = self._get_install_row_billing_meta(app_label)
						self.append(
							"install_apps",
							{
								"app_name": app_label,
								"source_type": meta.get("source_type"),
								"monthly_charge": meta.get("monthly_charge"),
								"is_allowed_by_plan": meta.get("is_allowed_by_plan", 1),
							},
						)
				else:
					remaining = []
					for row in self.get("install_apps") or []:
						if (row.app_name or "").strip() != app_label:
							remaining.append({"app_name": row.app_name})
					self.set("install_apps", remaining)

			self.flags.skip_reprepare_reset = True
			self.status = "Deployed"
			self.save(ignore_permissions=True)
			emit("Complete", 100, "success", f"{action_text} completed: {app_slug}")

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "site app action failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save(ignore_permissions=True)
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	def _queue_site_backup_action(
		self,
		*,
		action: str,
		restore_mode: str | None = None,
		backup_directory: str | None = None,
		db_backup_path: str | None = None,
		public_backup_path: str | None = None,
		private_backup_path: str | None = None,
		db_file_url: str | None = None,
		public_file_url: str | None = None,
		private_file_url: str | None = None,
	) -> dict:
		self.validate_server()
		if action not in {"backup", "restore"}:
			frappe.throw("Invalid backup action.")

		runtime = self._get_runtime_state()
		if not (runtime.get("ok") and runtime.get("running")):
			frappe.throw("Site containers are not running. Start containers before backup/restore.")

		if action == "restore":
			restore_mode = (restore_mode or "").strip()
			if restore_mode not in {"uploaded_files", "server_directory"}:
				frappe.throw("Choose a valid restore source.")

			if restore_mode == "server_directory":
				if not (backup_directory or "").strip():
					frappe.throw("Choose a backup directory from the server backups list.")
			else:
				if not db_file_url or not public_file_url or not private_file_url:
					frappe.throw("Upload database, public files and private files backups before restoring.")

		requested_by = frappe.session.user
		queued_at = frappe.utils.now_datetime()
		run_id = frappe.generate_hash(length=12)
		frappe.enqueue_doc(
			"Frappe Site",
			self.name,
			"_site_backup_action_background",
			queue="long",
			timeout=3600,
			action=action,
			run_id=run_id,
			restore_mode=(restore_mode or "").strip(),
			backup_directory=(backup_directory or "").strip(),
			db_backup_path=(db_backup_path or "").strip(),
			public_backup_path=(public_backup_path or "").strip(),
			private_backup_path=(private_backup_path or "").strip(),
			db_file_url=(db_file_url or "").strip(),
			public_file_url=(public_file_url or "").strip(),
			private_file_url=(private_file_url or "").strip(),
			requested_by=requested_by,
		)

		action_text = "Creating backup" if action == "backup" else "Restoring backup"
		payload = {
			"doc_name": self.name,
			"doc_type": "Frappe Site",
			"step": action_text,
			"percent": 5,
			"status": "running",
			"queued_at": queued_at,
			"run_id": run_id,
			"message": f"{action_text} queued, waiting for worker...",
		}
		frappe.publish_realtime(
			"nano_press:progress",
			payload,
			user=requested_by,
		)
		_set_site_action_progress(self.name, action, run_id, payload)

		return {
			"status": "queued",
			"queued_at": queued_at,
			"run_id": run_id,
			"message": f"{action_text} started in background.",
		}

	@frappe.whitelist()
	def reset_admin_password(self, new_password: str | None = None) -> dict:
		"""Reset the Administrator password for the deployed site.

		If ``new_password`` is empty, a random strong password is generated.
		"""
		self.validate_server()
		runtime = self._get_runtime_state()
		if not (runtime.get("ok") and runtime.get("running")):
			frappe.throw("Site containers are not running. Start containers before resetting password.")

		password = (new_password or "").strip() or random_string(16)
		site_name = (self.site_url or "").strip() or "frontend"

		result = run_playbook(
			server_name=self.server_name,
			playbook_path="reset_admin_password.yml",
			extra_vars={
				"bench_name": self.bench_name,
				"site_name": site_name,
				"admin_password": password,
			},
			timeout=300,
		)

		if result.get("status") != "success":
			raise Exception(f"reset_admin_password.yml failed: {result.get('message', 'Unknown error')}")

		self.flags.skip_reprepare_reset = True
		# Password fields are persisted securely by Frappe when assigned and saved.
		self.admin_password = password
		if not self.username:
			self.username = "Administrator"
		self.save(ignore_permissions=True)

		return {
			"status": "success",
			"message": "Administrator password reset successfully.",
			"username": self.username or "Administrator",
			"password": password,
		}

	def _set_maintenance_mode(self, enable: bool, reason: str = "Manual") -> dict:
		self.validate_server()
		runtime = self._get_runtime_state()
		if not (runtime.get("ok") and runtime.get("running")):
			frappe.throw(
				"Site containers are not running. Start containers before changing suspension state."
			)

		site_name = (self.site_url or "").strip() or "frontend"
		mode = "on" if enable else "off"
		suspension_message = "Your site is suspended, please renew your subscription to resume operation"

		result = run_playbook(
			server_name=self.server_name,
			playbook_path="set_maintenance_mode.yml",
			extra_vars={
				"bench_name": self.bench_name,
				"site_name": site_name,
				"maintenance_mode": mode,
				"maintenance_message": suspension_message,
			},
			timeout=300,
		)

		if result.get("status") != "success":
			raise Exception(f"set_maintenance_mode.yml failed: {result.get('message', 'Unknown error')}")

		self.flags.skip_reprepare_reset = True
		if enable:
			self.suspension_reason = reason
			if reason == "Billing":
				self.billing_status = "Suspended"
		else:
			self.suspension_reason = "Manual"
			if (self.billing_status or "").strip() == "Suspended":
				self.billing_status = "Active"
		self.save(ignore_permissions=True)

		return {
			"status": "success",
			"maintenance_mode": mode,
			"message": "Site suspended successfully." if enable else "Site unsuspended successfully.",
		}

	@frappe.whitelist()
	def suspend_site(self) -> dict:
		return self._set_maintenance_mode(True, reason="Manual")

	@frappe.whitelist()
	def unsuspend_site(self) -> dict:
		return self._set_maintenance_mode(False, reason="Manual")

	@frappe.whitelist()
	def create_site_backup(self) -> dict:
		return self._queue_site_backup_action(action="backup")

	@frappe.whitelist()
	def list_site_backups(self) -> dict:
		self.validate_server()
		result = run_playbook(
			server_name=self.server_name,
			playbook_path="list_site_backups.yml",
			extra_vars={
				"bench_name": self.bench_name,
				"site_name": self.site_url or "frontend",
				"backup_root_dir": self._remote_backup_root(),
			},
			timeout=120,
		)
		if result.get("status") != "success":
			raise Exception(f"list_site_backups.yml failed: {result.get('message', 'Unknown error')}")

		payload = self._extract_task_stdout(result, "Collect remote backup catalog")
		if not payload:
			return {
				"root_directory": f"{self._remote_backup_root()}/{self.site_url or 'frontend'}",
				"backups": [],
			}

		parsed = json.loads(payload)
		return {
			"root_directory": parsed.get("root_directory"),
			"backups": parsed.get("backups") or [],
		}

	@frappe.whitelist()
	def download_site_backup_file(self, backup_directory: str, file_name: str) -> dict:
		self.validate_server()
		backup_directory = self._normalize_backup_directory(backup_directory)

		safe_file_name = os.path.basename((file_name or "").strip())
		if not safe_file_name or safe_file_name != (file_name or "").strip():
			frappe.throw("Invalid backup file name.")

		remote_file_path = os.path.normpath(os.path.join(backup_directory, safe_file_name))
		if not remote_file_path.startswith(backup_directory + os.sep):
			frappe.throw("Invalid backup file path.")

		backup_label = os.path.basename(backup_directory.rstrip("/"))
		controller_download_dir = self._local_backup_download_dir(backup_label)
		os.makedirs(controller_download_dir, exist_ok=True)

		result = run_playbook(
			server_name=self.server_name,
			playbook_path="download_site_backup_file.yml",
			extra_vars={
				"remote_file_path": remote_file_path,
				"controller_download_dir": controller_download_dir,
			},
			timeout=300,
		)
		if result.get("status") != "success":
			raise Exception(
				f"download_site_backup_file.yml failed: {result.get('message', 'Unknown error')}"
			)

		local_file_path = os.path.join(controller_download_dir, safe_file_name)
		if not os.path.exists(local_file_path):
			frappe.throw(f"Downloaded backup file not found locally: {safe_file_name}")

		file_meta = self._create_downloadable_backup_file(
			absolute_path=local_file_path,
			backup_label=backup_label,
			kind=self._infer_backup_kind(safe_file_name),
		)
		return {
			"status": "success",
			"message": "Backup file downloaded successfully.",
			"file": file_meta,
		}

	@frappe.whitelist()
	def delete_site_backup_directory(self, backup_directory: str) -> dict:
		self.validate_server()
		backup_directory = self._normalize_backup_directory(backup_directory)
		backup_label = os.path.basename(backup_directory.rstrip("/"))

		result = run_playbook(
			server_name=self.server_name,
			playbook_path="delete_site_backup_directory.yml",
			extra_vars={
				"backup_directory": backup_directory,
				"backup_root_dir": self._backup_catalog_root(),
			},
			timeout=180,
		)
		if result.get("status") != "success":
			raise Exception(
				f"delete_site_backup_directory.yml failed: {result.get('message', 'Unknown error')}"
			)

		# Remove cached/downloaded local backup files and their File records.
		local_dir = self._local_backup_download_dir(backup_label)
		local_prefix = f"/private/files/nano_press_backups/{self.name}/{backup_label}/"
		attached_files = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": "Frappe Site",
				"attached_to_name": self.name,
			},
			fields=["name", "file_url"],
		)
		for row in attached_files:
			if (row.get("file_url") or "").startswith(local_prefix):
				try:
					frappe.delete_doc("File", row.get("name"), ignore_permissions=True, force=True)
				except Exception:
					pass

		if os.path.isdir(local_dir):
			shutil.rmtree(local_dir, ignore_errors=True)

		return {
			"status": "success",
			"message": "Backup directory deleted successfully.",
			"backup_directory": backup_directory,
		}

	@frappe.whitelist()
	def restore_site_backup(
		self,
		restore_mode: str,
		backup_directory: str | None = None,
		db_backup_path: str | None = None,
		public_backup_path: str | None = None,
		private_backup_path: str | None = None,
		db_file_url: str | None = None,
		public_file_url: str | None = None,
		private_file_url: str | None = None,
	) -> dict:
		return self._queue_site_backup_action(
			action="restore",
			restore_mode=restore_mode,
			backup_directory=backup_directory,
			db_backup_path=db_backup_path,
			public_backup_path=public_backup_path,
			private_backup_path=private_backup_path,
			db_file_url=db_file_url,
			public_file_url=public_file_url,
			private_file_url=private_file_url,
		)

	def _site_backup_action_background(
		self,
		action: str,
		run_id: str = "",
		restore_mode: str = "",
		backup_directory: str = "",
		db_backup_path: str = "",
		public_backup_path: str = "",
		private_backup_path: str = "",
		db_file_url: str = "",
		public_file_url: str = "",
		private_file_url: str = "",
		requested_by: str | None = None,
	):
		_user = requested_by or "Administrator"
		task_total = _count_playbook_tasks("manage_site_backup.yml")
		task_index = 0
		action_text = "Creating backup" if action == "backup" else "Restoring backup"
		controller_download_dir = ""
		backup_label = ""

		def emit(step, percent, status, message, **extra):
			payload = {
				"doc_name": self.name,
				"doc_type": "Frappe Site",
				"step": step,
				"percent": percent,
				"status": status,
				"message": message,
				"run_id": run_id,
				**extra,
			}
			# Update cache FIRST so polling always gets fresh data regardless of realtime
			_set_site_action_progress(self.name, action, run_id, payload)
			# Record last update timestamp for completion detection
			frappe.cache().set_value(
				f"nano_press:action_last_update:{self.name}:{action}:{run_id}",
				str(time.time()),
				expires_in_sec=600,
			)
			# Realtime is best-effort; never let it block the cache update
			try:
				frappe.publish_realtime(
					"nano_press:progress",
					payload,
					user=_user,
				)
			except Exception:
				pass

		def task_step(task_name: str) -> str:
			name_l = task_name.lower()
			running_step = "Running restore command" if action == "restore" else "Running backup command"
			starting_step = "Starting restore command" if action == "restore" else "Starting backup command"
			preparing_step = "Preparing restore operation" if action == "restore" else "Preparing backup operation"
			if (
				"wait for backup operation" in name_l
				or "probe backup operation" in name_l
				or "live backup operation logs" in name_l
			):
				return running_step
			if "copy uploaded" in name_l or "uploaded restore staging" in name_l:
				return "Preparing restore files"
			if "fetch backup artifacts" in name_l or "controller download directory" in name_l:
				return "Preparing backup downloads"
			if "backup artifact manifest" in name_l:
				return "Collecting backup files"
			if "start backup operation" in name_l:
				return starting_step
			if "wait for backup operation rc file" in name_l:
				return running_step
			if "validate restore backup file paths" in name_l or "validate restore source inputs" in name_l:
				return "Validating restore files"
			return preparing_step

		def handle_event(event: dict):
			nonlocal task_index
			task_name = (event.get("task_name") or "").strip()
			if not task_name:
				return

			step = task_step(task_name)

			if event.get("event") == "task_start":
				task_index += 1
				percent = min(95, max(10, round((task_index / task_total) * 90)))
				emit(
					step,
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
				detail = (
					_event_text(event.get("msg"))
					or _event_text(event.get("stderr"))
					or _event_text(event.get("stdout"))
				)
				emit(
					step,
					min(95, max(10, round((max(task_index, 1) / task_total) * 90))),
					"running",
					detail or f"{task_name}: {task_state}",
					task_name=task_name,
					task_state=task_state,
					task_detail=detail,
					task_index=task_index,
					task_total=task_total,
				)

		try:
			emit(action_text, 10, "running", "Worker picked up backup/restore job.")
			uploaded_files = {}
			if action == "restore" and restore_mode == "uploaded_files":
				uploaded_files = {
					"database": self._resolve_uploaded_backup_file(db_file_url),
					"public": self._resolve_uploaded_backup_file(public_file_url),
					"private": self._resolve_uploaded_backup_file(private_file_url),
				}

			if action == "backup":
				backup_label = frappe.utils.now_datetime().strftime("%d%m%Y-%H%M")
				controller_download_dir = self._local_backup_download_dir(backup_label)
				os.makedirs(controller_download_dir, exist_ok=True)

			result = run_playbook(
				server_name=self.server_name,
				playbook_path="manage_site_backup.yml",
				extra_vars={
					"bench_name": self.bench_name,
					"site_name": self.site_url or "frontend",
					"backup_root_dir": self._remote_backup_root(),
					"backup_label": backup_label,
					"controller_download_dir": controller_download_dir,
					"backup_action": action,
					"restore_mode": restore_mode,
					"restore_backup_dir": backup_directory,
					"db_backup_path": db_backup_path,
					"public_backup_path": public_backup_path,
					"private_backup_path": private_backup_path,
					"uploaded_db_local_path": uploaded_files.get("database", {}).get("absolute_path", ""),
					"uploaded_db_file_name": uploaded_files.get("database", {}).get("file_name", ""),
					"uploaded_public_local_path": uploaded_files.get("public", {}).get("absolute_path", ""),
					"uploaded_public_file_name": uploaded_files.get("public", {}).get("file_name", ""),
					"uploaded_private_local_path": uploaded_files.get("private", {}).get("absolute_path", ""),
					"uploaded_private_file_name": uploaded_files.get("private", {}).get("file_name", ""),
				},
				event_handler=handle_event,
			)
			if result.get("status") != "success":
				raise Exception(f"manage_site_backup.yml failed: {result.get('message', 'Unknown error')}")

			success_payload = {}
			if action == "backup":
				manifest_raw = self._extract_task_stdout(result, "Read backup artifact manifest")
				manifest = json.loads(manifest_raw) if manifest_raw else {}
				registered_files = self._register_backup_downloads(
					backup_label=manifest.get("backup_label") or backup_label,
					controller_download_dir=controller_download_dir,
					manifest=manifest,
				)
				success_payload = {
					"backup_label": manifest.get("backup_label") or backup_label,
					"backup_directory": manifest.get("backup_dir") or "",
					"backup_files": registered_files,
				}

			self.flags.skip_reprepare_reset = True
			self.status = "Deployed"
			self.save(ignore_permissions=True)
			emit("Complete", 100, "success", f"{action_text} completed.", **success_payload)

		except Exception as exc:
			frappe.log_error(frappe.get_traceback(), "site backup action failed")
			self.reload()
			self.flags.skip_reprepare_reset = True
			self.status = "Failed"
			self.save(ignore_permissions=True)
			emit("Failed", 0, "failed", frappe.utils.cstr(exc))

	@frappe.whitelist()
	def get_site_action_progress(self, action: str, run_id: str) -> dict:
		self.validate_server()
		action = (action or "").strip().lower()
		if action not in {"backup", "restore", "install", "uninstall"}:
			frappe.throw("Invalid action for progress query.")
		
		# Get current progress from cache
		progress = _get_site_action_progress(self.name, action, (run_id or "").strip())
		
		# For backup/restore, if no progress found or stuck at 5%, check completion markers.
		if action in {"backup", "restore"} and (not progress or progress.get("percent", 0) <= 5):
			completion = _check_action_completion(self.name, action, (run_id or "").strip())
			if completion:
				return completion
		
		return progress


@frappe.whitelist()
def prepare_for_deployment(site_name: str) -> dict:
	"""Wrapper function to call prepare_for_deployment on a Frappe Site document"""
	doc = frappe.get_doc("Frappe Site", site_name)
	return doc.prepare_for_deployment()


@frappe.whitelist()
def get_site_credentials(site_name: str) -> dict:
	"""Get the username and password for a Frappe Site.

	Args:
		site_name: Name of the Frappe Site document

	Returns:
		dict: {username, password}
	"""
	try:
		if not frappe.db.exists("Frappe Site", site_name):
			frappe.throw(f"Frappe Site {site_name} not found")

		doc = frappe.get_doc("Frappe Site", site_name)

		return {
			"username": doc.username or "Administrator",
			"password": doc.get_password("admin_password") or "",
		}

	except Exception as e:
		frappe.log_error(f"Error getting site credentials: {e}")
		return {"username": "", "password": ""}


@frappe.whitelist()
def deploy_site(site_name: str) -> dict:
	"""Wrapper function to call deploy_site on a Frappe Site document"""
	doc = frappe.get_doc("Frappe Site", site_name)
	return doc.deploy_site()


@frappe.whitelist()
def get_runtime_progress(site_name: str) -> dict:
	"""Wrapper function to fetch raw runtime progress for a Frappe Site."""
	doc = frappe.get_doc("Frappe Site", site_name)
	return {"runtime": doc._get_runtime_state()}


@frappe.whitelist()
def get_site_action_progress(site_name: str, action: str, run_id: str) -> dict:
	"""Wrapper function to fetch backup/restore progress state for a specific run."""
	doc = frappe.get_doc("Frappe Site", site_name)
	return doc.get_site_action_progress(action=action, run_id=run_id)
