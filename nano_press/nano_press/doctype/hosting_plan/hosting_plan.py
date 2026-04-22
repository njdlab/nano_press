import frappe
from frappe.model.document import Document


class HostingPlan(Document):
	def validate(self):
		seen_apps = set()
		for row in self.get("included_apps") or []:
			app_name = (row.app_name or "").strip()
			if not app_name:
				continue
			if app_name in seen_apps:
				frappe.throw(f"App '{app_name}' is duplicated in Included Apps.")
			seen_apps.add(app_name)
