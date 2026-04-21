# Copyright (c) 2025, Venkatesh M and contributors
# For license information, please see license.txt

import re

# import frappe
from frappe.model.document import Document


class Apps(Document):
	def before_insert(self):
		self.scrubbed_name = self.app_name.replace(" ", "_").lower()
		self._derive_module_name()

	def before_save(self):
		self._derive_module_name()

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
