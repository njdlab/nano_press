# Copyright (c) 2025, Venkatesh M and contributors
# For license information, please see license.txt

import re

import frappe
from frappe.model.document import Document


class Apps(Document):
	def before_insert(self):
		self.scrubbed_name = self.app_name.replace(" ", "_").lower()
		self._derive_module_name()

	def before_save(self):
		self._derive_module_name()
		self._validate_billing_fields()

	def _derive_module_name(self):
		"""Derive the actual Python module name from the repository URL.

		Examples:
			https://github.com/frappe/erpnext.git -> erpnext
			https://github.com/frappe/hrms.git -> hrms
			https://github.com/custom-org/my-app.git -> my-app
		"""
		if not self.repo_url:
			return

		# Extract the repo name from URL (last part before .git)
		# Handle both https://... and git@... URLs
		match = re.search(r"([^/]+?)(?:\.git)?/?$", self.repo_url.strip())
		if match:
			self.module_name = match.group(1)

	def _validate_billing_fields(self):
		if int(self.get("is_billable_addon") or 0):
			monthly = float(self.get("monthly_price") or 0)
			onetime = float(self.get("one_time_price") or 0)
			if monthly <= 0 and onetime <= 0:
				frappe.throw("Billable addon apps must have a monthly or one-time price greater than zero.")
			if not self.get("app_category"):
				self.app_category = "Addon"
