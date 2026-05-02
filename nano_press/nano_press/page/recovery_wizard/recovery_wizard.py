# Copyright (c) 2026, NJD Lab and contributors
# For license information, please see license.txt

import json
import re

import frappe

from nano_press.utils.ansible_runner import run_playbook


def _extract_scan_data(result: dict) -> dict:
        """Parse scan payload from run_playbook wrapper or raw ansible result."""
        payload = result.get("data") if isinstance(result.get("data"), dict) else result
        raw_json = payload.get("raw_json", {})

        for play in raw_json.get("plays", []):
                for task in play.get("tasks", []):
                        task_name = (task.get("task", {}).get("name") or "").strip()
                        if task_name != "Emit scan results":
                                continue

                        for _host, host_result in task.get("hosts", {}).items():
                                msg = host_result.get("msg", "")
                                if isinstance(msg, dict):
                                        return msg
                                if isinstance(msg, str):
                                        try:
                                                parsed = json.loads(msg)
                                                if isinstance(parsed, dict):
                                                        return parsed
                                        except Exception:
                                                pass

        return {"images": [], "sites": []}


def _derive_app_name_from_repo(repo_url: str, fallback: str = "") -> str:
        """Derive app name from a repository URL when manifest omits app_name."""
        if repo_url:
                match = re.search(r"([^/]+?)(?:\.git)?/?$", repo_url.strip())
                if match:
                        return match.group(1)
        return fallback


def _ensure_apps_catalog_from_manifest(manifest_apps: list[dict]) -> tuple[list[str], list[dict]]:
        """Ensure Apps records exist for manifest entries so apps_config can be restored."""
        created_apps: list[str] = []
        unresolved: list[dict] = []

        for app in manifest_apps:
                if not isinstance(app, dict):
                        continue

                repo_url = (app.get("repo_url") or "").strip()
                app_name = (app.get("app_name") or "").strip() or _derive_app_name_from_repo(repo_url)
                branch = (app.get("branch") or "").strip() or "main"

                if not app_name or not repo_url:
                        unresolved.append(
                                {
                                        "type": "app-catalog",
                                        "ref": app_name or repo_url or "unknown",
                                        "reason": "Missing app_name or repo_url in manifest",
                                }
                        )
                        continue

                if frappe.db.exists("Apps", app_name):
                        continue

                doc = frappe.get_doc(
                        {
                                "doctype": "Apps",
                                "app_name": app_name,
                                "repo_url": repo_url,
                                "branch": branch,
                                "enabled": 1,
                                "is_public": int(app.get("is_public", 1)),
                        }
                )
                if app.get("module_name"):
                        doc.module_name = app.get("module_name")
                if app.get("scrubbed_name"):
                        doc.scrubbed_name = app.get("scrubbed_name")

                doc.flags.ignore_mandatory = True
                doc.insert(ignore_permissions=True)
                created_apps.append(app_name)

        return created_apps, unresolved


def _build_manifest_from_custom_image(doc) -> dict:
        """Build manifest payload from an existing Custom Image doc."""
        apps_config = []

        for row in doc.get("apps_config") or []:
                if not row.app_name:
                        continue

                repo_url = ""
                branch = ""
                module_name = ""
                scrubbed_name = ""
                is_public = 1

                if frappe.db.exists("Apps", row.app_name):
                        app_doc = frappe.get_cached_doc("Apps", row.app_name)
                        repo_url = app_doc.get("repo_url") or ""
                        branch = app_doc.get("branch") or ""
                        module_name = app_doc.get("module_name") or ""
                        scrubbed_name = app_doc.get("scrubbed_name") or ""
                        is_public = int(app_doc.get("is_public") or 0)

                apps_config.append(
                        {
                                "app_name": row.app_name,
                                "repo_url": repo_url,
                                "branch": branch,
                                "module_name": module_name,
                                "scrubbed_name": scrubbed_name,
                                "is_public": is_public,
                        }
                )

        frappe_version = (doc.get("frappe_version") or "version-16").strip()
        if frappe_version not in {"version-16", "version-15", "version-14"}:
                frappe_version = "version-16"

        return {
                "manifest_version": 1,
                "image_tag": doc.get("image_tag") or "",
                "image_name": doc.get("image_name") or "",
                "frappe_version": frappe_version,
                "apps_json_base64": doc.get("apps_json_base64") or "W10=",
                "apps_config": apps_config,
                "generated_at": str(frappe.utils.now_datetime()),
                "source": "db-backfill",
        }


@frappe.whitelist()
def backfill_recovery_manifests():
        """Backfill worker-side manifests for already-built Custom Image records."""
        built_images = frappe.get_all(
                "Custom Image",
                filters={"build_status": "Built"},
                fields=["name", "server_name", "image_tag"],
        )

        manifests_by_server: dict[str, list[dict]] = {}
        skipped: list[dict] = []

        for row in built_images:
                server_name = row.get("server_name")
                image_tag = row.get("image_tag")

                if not server_name:
                        skipped.append(
                                {
                                        "type": "image",
                                        "ref": row.get("name") or image_tag or "unknown",
                                        "reason": "Missing server_name",
                                }
                        )
                        continue

                if not image_tag:
                        skipped.append(
                                {
                                        "type": "image",
                                        "ref": row.get("name") or "unknown",
                                        "reason": "Missing image_tag",
                                }
                        )
                        continue

                doc = frappe.get_doc("Custom Image", row.get("name"))
                manifest = _build_manifest_from_custom_image(doc)
                manifests_by_server.setdefault(server_name, []).append(manifest)

        written = 0
        server_results = []
        errors = []

        for server_name, manifests in manifests_by_server.items():
                try:
                        result = run_playbook(
                                server_name=server_name,
                                playbook_path="backfill_recovery_manifests.yml",
                                extra_vars={"manifests": manifests},
                                become=True,
                        )

                        if not result.get("ok"):
                                errors.append(
                                        {
                                                "server": server_name,
                                                "error": (result.get("data", {}) or {}).get("stderr_tail")
                                                or result.get("message")
                                                or "Playbook failed",
                                        }
                                )
                                continue

                        written += len(manifests)
                        server_results.append(
                                {
                                        "server": server_name,
                                        "written": len(manifests),
                                }
                        )
                except Exception as exc:
                        errors.append({"server": server_name, "error": str(exc)})

        return {
                "server_count": len(manifests_by_server),
                "images_total": len(built_images),
                "manifests_written": written,
                "server_results": server_results,
                "skipped": skipped,
                "errors": errors,
        }


@frappe.whitelist()
def scan_all_servers():
        """
        Scan every Server document for running Docker Compose stacks and custom
        images. Returns a preview dict for the Recovery Wizard UI.
        """
        servers = frappe.get_all("Server", fields=["name", "server_ip"])
        all_images, all_sites, errors = [], [], []

        for srv in servers:
                try:
                        result = run_playbook(
                                host=srv.server_ip,
                                server_name=srv.name,
                                playbook_path="scan_server.yml",
                                become=True,
                        )
                        if not result.get("ok"):
                                errors.append(
                                        {
                                                "server": srv.name,
                                                "error": (result.get("data", {}) or {}).get("stderr_tail")
                                                or result.get("message")
                                                or "Playbook failed",
                                        }
                                )
                                continue

                        data = _extract_scan_data(result)

                        for img in data.get("images", []):
                                tag = img.get("image_tag", "")
                                img["server"] = srv.name
                                img["exists"] = bool(
                                        frappe.db.exists("Custom Image", {"image_tag": tag}) if tag else False
                                )
                                all_images.append(img)

                        for site in data.get("sites", []):
                                url = site.get("site_url", "")
                                site["server"] = srv.name
                                site["exists"] = bool(
                                        frappe.db.exists("Frappe Site", {"site_url": url}) if url else False
                                )
                                all_sites.append(site)

                except Exception as exc:
                        errors.append({"server": srv.name, "error": str(exc)})

        return {
                "images": all_images,
                "sites": all_sites,
                "server_count": len(servers),
                "errors": errors,
        }


@frappe.whitelist()
def import_recovery_data(images, sites):
        """
        Create Custom Image and Frappe Site records for selected items.

        Args:
                images: JSON list of image dicts (from scan_all_servers)
                sites: JSON list of site dicts (from scan_all_servers)

        Returns:
                dict with created_images, created_sites, skipped lists
        """
        images_list = json.loads(images) if isinstance(images, str) else (images or [])
        sites_list = json.loads(sites) if isinstance(sites, str) else (sites or [])

        created_images, created_sites, created_catalog_apps, skipped = [], [], [], []

        for img in images_list:
                tag = img.get("image_tag", "")
                if not tag:
                        continue
                if frappe.db.exists("Custom Image", {"image_tag": tag}):
                        skipped.append({"type": "image", "ref": tag, "reason": "Already exists"})
                        continue

                manifest = img.get("recovery_manifest") if isinstance(img.get("recovery_manifest"), dict) else {}
                manifest_apps = manifest.get("apps_config") if isinstance(manifest.get("apps_config"), list) else []
                image_name = manifest.get("image_name") or img.get("repo", tag.split(":")[0])

                apps_json_base64 = manifest.get("apps_json_base64") or "W10="
                frappe_version = (manifest.get("frappe_version") or "version-16").strip()
                valid_versions = {"version-16", "version-15", "version-14"}
                if frappe_version not in valid_versions:
                        frappe_version = "version-16"

                created_apps, unresolved_apps = _ensure_apps_catalog_from_manifest(manifest_apps)
                created_catalog_apps.extend(created_apps)
                skipped.extend(unresolved_apps)

                apps_config_rows = []
                seen_apps = set()
                for app in manifest_apps:
                        if not isinstance(app, dict):
                                continue
                        app_name = (app.get("app_name") or "").strip() or _derive_app_name_from_repo(
                                (app.get("repo_url") or "").strip()
                        )
                        if not app_name or app_name in seen_apps:
                                continue
                        if not frappe.db.exists("Apps", app_name):
                                skipped.append(
                                        {
                                                "type": "image-app",
                                                "ref": f"{tag}:{app_name}",
                                                "reason": "App not found in Apps catalog",
                                        }
                                )
                                continue
                        apps_config_rows.append({"app_name": app_name})
                        seen_apps.add(app_name)

                payload = {
                        "doctype": "Custom Image",
                        "image_name": image_name,
                        "image_tag": tag,
                        "server_name": img.get("server", ""),
                        "build_status": "Built",
                        "frappe_version": frappe_version,
                        "apps_json_base64": apps_json_base64,
                }
                if apps_config_rows:
                        payload["apps_config"] = apps_config_rows

                doc = frappe.get_doc(payload)
                doc.flags.ignore_mandatory = True
                doc.insert(ignore_permissions=True)
                created_images.append(doc.name)

        for site in sites_list:
                url = site.get("site_url", "")
                if not url:
                        continue
                if frappe.db.exists("Frappe Site", {"site_url": url}):
                        skipped.append({"type": "site", "ref": url, "reason": "Already exists"})
                        continue

                doc = frappe.get_doc(
                        {
                                "doctype": "Frappe Site",
                                "bench_name": site.get("bench_name", ""),
                                "site_url": url,
                                "server_name": site.get("server", ""),
                                "docker_image": site.get("docker_image", ""),
                                "admin_password": site.get("admin_password", ""),
                                "db_username": site.get("db_username", "root"),
                                "db_password": site.get("db_password", ""),
                                "status": "Active",
                        }
                )
                doc.flags.ignore_mandatory = True
                doc.insert(ignore_permissions=True)
                created_sites.append(doc.name)

        frappe.db.commit()

        return {
                "created_images": created_images,
                "created_sites": created_sites,
                "created_catalog_apps": sorted(set(created_catalog_apps)),
                "skipped": skipped,
        }
