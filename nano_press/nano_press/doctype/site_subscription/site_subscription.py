import frappe
from frappe.model.document import Document
from frappe.utils import add_days, nowdate

_ACTIVE_STATUSES = {"Active", "Grace", "Suspended"}


class SiteSubscription(Document):
	def validate(self):
		self._validate_unique_active_subscription()
		self._sync_from_plan_if_missing()
		self._validate_site_customer_consistency()
		self._validate_dates()
		self._validate_addons()

	def on_update(self):
		self._sync_site_billing_fields()

	def on_trash(self):
		if not self.site or not frappe.db.exists("Frappe Site", self.site):
			return
		site = frappe.get_doc("Frappe Site", self.site)
		if site.active_subscription == self.name:
			site.active_subscription = None
			site.billing_status = "Not Linked"
			site.save(ignore_permissions=True)

	def _validate_unique_active_subscription(self):
		if self.status not in _ACTIVE_STATUSES:
			return
		existing = frappe.get_all(
			"Site Subscription",
			filters={"site": self.site, "status": ["in", list(_ACTIVE_STATUSES)], "name": ["!=", self.name]},
			fields=["name"],
			limit=1,
		)
		if existing:
			frappe.throw(
				f"Site '{self.site}' already has an active subscription ({existing[0].name}). "
				"Cancel it before activating another one."
			)

	def _sync_from_plan_if_missing(self):
		if not self.plan:
			return
		plan = frappe.get_cached_doc("Hosting Plan", self.plan)

		if not self.billing_cycle:
			self.billing_cycle = plan.billing_cycle or "Monthly"
		if self.grace_days is None:
			self.grace_days = plan.grace_days
		if self.base_price_monthly in (None, 0):
			self.base_price_monthly = plan.base_price_monthly
		if self.storage_quota_gb in (None, 0):
			self.storage_quota_gb = plan.storage_quota_gb
		if self.included_employees is None:
			self.included_employees = plan.included_employees
		if self.extra_employee_price in (None, 0):
			self.extra_employee_price = plan.extra_employee_price
		if self.extra_storage_price_per_gb in (None, 0):
			self.extra_storage_price_per_gb = plan.extra_storage_price_per_gb
		if self.auto_suspend_enabled is None:
			self.auto_suspend_enabled = plan.auto_suspend_enabled

		if not self.start_date:
			self.start_date = nowdate()
		if not self.next_billing_date and self.start_date:
			days = 30 if (self.billing_cycle or "Monthly") == "Monthly" else 365
			self.next_billing_date = add_days(self.start_date, days)

	def _validate_site_customer_consistency(self):
		if not self.site or not frappe.db.exists("Frappe Site", self.site):
			return
		site = frappe.get_doc("Frappe Site", self.site)
		site_customer = (site.customer or "").strip()
		sub_customer = (self.customer or "").strip()

		if site_customer and sub_customer and site_customer != sub_customer:
			frappe.throw(
				f"Site '{self.site}' belongs to Customer '{site_customer}', "
				f"but subscription has '{sub_customer}'."
			)

		if not site_customer and sub_customer:
			site.customer = sub_customer
			site.save(ignore_permissions=True)

	def _validate_dates(self):
		if self.status in _ACTIVE_STATUSES and not self.next_billing_date:
			frappe.throw("Next Billing Date is required for active subscriptions.")

	def _validate_addons(self):
		seen = set()
		for row in self.get("addons") or []:
			name = (row.app_name or "").strip()
			if not name:
				continue
			if name in seen:
				frappe.throw(f"Addon app '{name}' is duplicated.")
			seen.add(name)

	def _sync_site_billing_fields(self):
		if not self.site or not frappe.db.exists("Frappe Site", self.site):
			return
		site = frappe.get_doc("Frappe Site", self.site)
		site.active_subscription = self.name if self.status in _ACTIVE_STATUSES else None
		site.billing_status = self.status if self.status in _ACTIVE_STATUSES else "Cancelled"
		site.storage_quota_gb = self.storage_quota_gb or 0
		site.employee_limit = self.included_employees or 0
		site.allow_overage = self.allow_overage
		site.overage_policy = self.overage_policy or "Bill"
		if self.status == "Suspended" and self.suspended_by_billing:
			site.suspension_reason = "Billing"
		site.save(ignore_permissions=True)
