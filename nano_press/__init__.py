import frappe
from frappe.utils.user import is_website_user

__version__ = "0.0.1"


def has_app_permission():
	if frappe.session.user == "Administrator":
		return True

	if is_website_user():
		return False

	return True


def add_user_role(doc, event=None):
	doc.add_roles("Nano Press User")


def ensure_nano_press_desktop_route():
	"""Normalize Nano Press desktop app icon route to an absolute desk path.

	This keeps app navigation stable even if Desktop Icon records were created
	manually from layout editor with inconsistent link settings.
	"""
	if not frappe.db.exists("DocType", "Desktop Icon"):
		return

	icons = frappe.get_all(
		"Desktop Icon",
		filters={"icon_type": "App", "label": "Nano Press"},
		fields=["name", "link", "link_type", "app"],
	)

	updated = False
	for icon in icons:
		updates = {}
		if (icon.get("link") or "") != "/app/nano-press":
			updates["link"] = "/app/nano-press"
		if (icon.get("link_type") or "") != "External":
			updates["link_type"] = "External"
		if (icon.get("app") or "") != "nano_press":
			updates["app"] = "nano_press"

		if updates:
			frappe.db.set_value("Desktop Icon", icon.name, updates, update_modified=False)
			updated = True

	if updated:
		frappe.cache.delete_key("desktop_icons")
		frappe.cache.delete_key("bootinfo")


def ensure_nano_press_workspace_sidebar():
	"""Ensure Nano Press desk sidebar has sectioned links and monitoring page."""
	if not frappe.db.exists("DocType", "Workspace Sidebar"):
		return

	# Standard workspace sidebars are keyed by title/name and for_user is empty.
	sidebar_name = frappe.db.get_value(
		"Workspace Sidebar",
		{"title": "Nano Press", "for_user": ["in", [None, ""]]},
		"name",
	)

	if not sidebar_name and frappe.db.exists("Workspace Sidebar", "Nano Press"):
		sidebar_name = "Nano Press"

	if sidebar_name:
		sidebar = frappe.get_doc("Workspace Sidebar", sidebar_name)
	else:
		sidebar = frappe.get_doc(
			{
				"doctype": "Workspace Sidebar",
				"name": "Nano Press",
				"title": "Nano Press",
				"module": "Nano Press",
				"app": "nano_press",
				"standard": 1,
			}
		)
		sidebar.insert(ignore_permissions=True)

	desired_items = [
		{"type": "Link", "label": "Home", "link_type": "Workspace", "link_to": "Nano Press", "child": 0},
		{"type": "Section Break", "label": "Servers", "indent": 1, "child": 0},
		{"type": "Link", "label": "List of Servers", "link_type": "DocType", "link_to": "Server", "child": 1},
		{
			"type": "Link",
			"label": "Server Monitoring",
			"link_type": "Page",
			"link_to": "server-monitoring",
			"child": 1,
		},
		{
			"type": "Link",
			"label": "Server Metrics",
			"link_type": "DocType",
			"link_to": "Server Metrics Snapshot",
			"child": 1,
		},
		{
			"type": "Link",
			"label": "Server Alerts",
			"link_type": "DocType",
			"link_to": "Server Health Alert",
			"child": 1,
		},
		{"type": "Section Break", "label": "Sites", "indent": 1, "child": 0},
		{"type": "Link", "label": "Create New Site", "link_type": "DocType", "link_to": "Frappe Site", "child": 1},
		{
			"type": "Link",
			"label": "Site Subscriptions",
			"link_type": "DocType",
			"link_to": "Site Subscription",
			"child": 1,
		},
		{"type": "Section Break", "label": "Images & Apps", "indent": 1, "child": 0},
		{
			"type": "Link",
			"label": "Build a Custom Image",
			"link_type": "DocType",
			"link_to": "Custom Image",
			"child": 1,
		},
		{"type": "Link", "label": "Apps", "link_type": "DocType", "link_to": "Apps", "child": 1},
		{
			"type": "Link",
			"label": "Hosting Plans",
			"link_type": "DocType",
			"link_to": "Hosting Plan",
			"child": 1,
		},
	]

	sidebar.set("items", [])
	for row in desired_items:
		sidebar.append(
			"items",
			{
				"type": row.get("type"),
				"label": row.get("label"),
				"link_type": row.get("link_type"),
				"link_to": row.get("link_to"),
				"child": row.get("child", 0),
				"indent": row.get("indent", 0),
				"collapsible": 1,
			},
		)

	sidebar.save(ignore_permissions=True)
	frappe.clear_cache()


def ensure_nano_press_navigation():
	"""Sync all Nano Press desk navigation artifacts."""
	ensure_nano_press_desktop_route()
	ensure_nano_press_workspace_sidebar()


def _default_apps_catalog() -> list[dict]:
	"""Return default Apps records for both version-16 and version-15.

	Orders are intentionally spaced so more apps can be inserted later.
	"""
	v16 = [
		# Core
		{"app_name": "frappe-version-16", "repo_url": "https://github.com/frappe/frappe", "branch": "version-16", "order": 10, "app_category": "Core", "frappe": 1},
		{"app_name": "erpnext-version-16", "repo_url": "https://github.com/frappe/erpnext", "branch": "version-16", "order": 20, "app_category": "Core"},
		# Standalone apps
		{"app_name": "crm-version-16", "repo_url": "https://github.com/frappe/crm", "branch": "version-16", "order": 30, "app_category": "Addon"},
		{"app_name": "helpdesk-version-16", "repo_url": "https://github.com/frappe/helpdesk", "branch": "version-16", "order": 40, "app_category": "Addon"},
		{"app_name": "insights-version-16", "repo_url": "https://github.com/frappe/insights", "branch": "version-16", "order": 50, "app_category": "Addon"},
		{"app_name": "lms-version-16", "repo_url": "https://github.com/frappe/lms", "branch": "version-16", "order": 60, "app_category": "Addon"},
		{"app_name": "builder-version-16", "repo_url": "https://github.com/frappe/builder", "branch": "version-16", "order": 70, "app_category": "Addon"},
		{"app_name": "drive-version-16", "repo_url": "https://github.com/frappe/drive", "branch": "version-16", "order": 80, "app_category": "Addon"},
		{"app_name": "wiki-version-16", "repo_url": "https://github.com/frappe/wiki", "branch": "version-16", "order": 90, "app_category": "Addon"},
		{"app_name": "gameplan-version-16", "repo_url": "https://github.com/frappe/gameplan", "branch": "version-16", "order": 100, "app_category": "Addon"},
		{"app_name": "newsletter-version-16", "repo_url": "https://github.com/frappe/newsletter", "branch": "version-16", "order": 110, "app_category": "Addon"},
		{"app_name": "print_designer-version-16", "repo_url": "https://github.com/frappe/print_designer", "branch": "version-16", "order": 120, "app_category": "Addon"},
		{"app_name": "telephony-version-16", "repo_url": "https://github.com/frappe/telephony", "branch": "version-16", "order": 130, "app_category": "Integration"},
		{"app_name": "offsite_backups-version-16", "repo_url": "https://github.com/frappe/offsite_backups", "branch": "version-16", "order": 140, "app_category": "Integration"},
		# Requires ERPNext
		{"app_name": "hrms-version-16", "repo_url": "https://github.com/frappe/hrms", "branch": "version-16", "order": 200, "app_category": "Addon"},
		{"app_name": "lending-version-16", "repo_url": "https://github.com/frappe/lending", "branch": "version-16", "order": 210, "app_category": "Addon"},
		{"app_name": "education-version-16", "repo_url": "https://github.com/frappe/education", "branch": "version-16", "order": 220, "app_category": "Addon"},
		{"app_name": "webshop-version-16", "repo_url": "https://github.com/frappe/webshop", "branch": "version-16", "order": 230, "app_category": "Addon"},
		{"app_name": "agriculture-version-16", "repo_url": "https://github.com/frappe/agriculture", "branch": "version-16", "order": 240, "app_category": "Addon"},
		{"app_name": "ecommerce_integrations-version-16", "repo_url": "https://github.com/frappe/ecommerce_integrations", "branch": "version-16", "order": 250, "app_category": "Integration"},
		{"app_name": "waba_integration-version-16", "repo_url": "https://github.com/frappe/waba_integration", "branch": "version-16", "order": 260, "app_category": "Integration"},
	]

	v15 = [
		{**row, "app_name": row["app_name"].replace("version-16", "version-15"), "branch": "version-15", "order": row["order"] + 1000}
		for row in v16
	]

	return v16 + v15


def seed_default_apps() -> dict:
	"""Create/update default Apps records used by Nano Press.

	This is idempotent and safe to run repeatedly.
	"""
	if not frappe.db.exists("DocType", "Apps"):
		return {"created": 0, "updated": 0, "total": 0, "message": "Apps DocType not found"}

	created = 0
	updated = 0

	for row in _default_apps_catalog():
		name = row["app_name"]
		existing = frappe.db.exists("Apps", name)
		if existing:
			doc = frappe.get_doc("Apps", name)
		else:
			doc = frappe.new_doc("Apps")
			doc.app_name = name

		doc.repo_url = row["repo_url"]
		doc.branch = row["branch"]
		doc.order = row["order"]
		doc.enabled = 1
		doc.is_public = 1
		doc.frappe = int(row.get("frappe") or 0)
		doc.app_category = row.get("app_category") or "Core"

		doc.save(ignore_permissions=True)
		if existing:
			updated += 1
		else:
			created += 1

	frappe.clear_cache()
	return {"created": created, "updated": updated, "total": created + updated}


def ensure_nano_press_setup():
	"""Run all post-install and post-migrate setup tasks."""
	ensure_nano_press_navigation()
	seed_default_apps()


@frappe.whitelist()
def get_admin_password(site_name):
	if not frappe.has_permission("Frappe Site", "read", site_name):
		frappe.throw(
			frappe._("You do not have permission to access this Frappe Site"), frappe.PermissionError
		)

	site = frappe.get_cached_doc("Frappe Site", site_name)
	return site.get_password("admin_password")
