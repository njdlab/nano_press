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


@frappe.whitelist()
def get_admin_password(site_name):
	if not frappe.has_permission("Frappe Site", "read", site_name):
		frappe.throw(
			frappe._("You do not have permission to access this Frappe Site"), frappe.PermissionError
		)

	site = frappe.get_cached_doc("Frappe Site", site_name)
	return site.get_password("admin_password")
