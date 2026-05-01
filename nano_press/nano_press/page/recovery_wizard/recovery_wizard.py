# Copyright (c) 2026, NJD Lab and contributors
# For license information, please see license.txt

import json

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

        created_images, created_sites, skipped = [], [], []

        for img in images_list:
                tag = img.get("image_tag", "")
                if not tag:
                        continue
                if frappe.db.exists("Custom Image", {"image_tag": tag}):
                        skipped.append({"type": "image", "ref": tag, "reason": "Already exists"})
                        continue

                image_name = img.get("repo", tag.split(":")[0])
                doc = frappe.get_doc(
                        {
                                "doctype": "Custom Image",
                                "image_name": image_name,
                                "image_tag": tag,
                                "server_name": img.get("server", ""),
                                "build_status": "Built",
                                "frappe_version": "version-16",
                                "apps_json_base64": "W10=",  # base64('[]') for recovered images
                        }
                )
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
                "skipped": skipped,
        }
