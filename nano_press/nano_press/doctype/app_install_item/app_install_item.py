import frappe
from frappe.model.document import Document


class AppInstallItem(Document):
	def validate(self):
		source = (self.source_type or "").strip()
		if source == "Paid Addon" and float(self.monthly_charge or 0) <= 0:
			frappe.throw("Paid Addon rows must have a monthly charge greater than zero.")
