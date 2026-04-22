import frappe
from frappe.utils import add_days, getdate, nowdate


def process_subscription_billing_status():
	"""Daily subscription status evaluation for grace/suspension automation."""
	today = getdate(nowdate())
	subscriptions = frappe.get_all(
		"Site Subscription",
		filters={"status": ["in", ["Active", "Grace", "Suspended"]]},
		fields=[
			"name",
			"site",
			"status",
			"next_billing_date",
			"grace_days",
			"auto_suspend_enabled",
			"reactivate_on_payment",
			"suspended_by_billing",
		],
	)

	for row in subscriptions:
		try:
			_handle_subscription(row, today)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Billing scheduler failed for {row.name}")


def _handle_subscription(row, today):
	next_due = getdate(row.next_billing_date) if row.next_billing_date else None
	if not next_due:
		return

	grace_days = int(row.grace_days or 0)
	grace_end = add_days(next_due, grace_days)

	sub = frappe.get_doc("Site Subscription", row.name)
	site = (
		frappe.get_doc("Frappe Site", row.site)
		if row.site and frappe.db.exists("Frappe Site", row.site)
		else None
	)

	if today <= next_due:
		if sub.status != "Active":
			sub.status = "Active"
			sub.suspended_by_billing = 0
			sub.save(ignore_permissions=True)
		if site:
			site.billing_status = "Active"
			site.save(ignore_permissions=True)
		return

	if today <= grace_end:
		if sub.status != "Grace":
			sub.status = "Grace"
			sub.save(ignore_permissions=True)
		if site:
			site.billing_status = "Grace"
			site.save(ignore_permissions=True)
		return

	if not int(sub.auto_suspend_enabled or 0):
		return

	if site and sub.status != "Suspended":
		site._set_maintenance_mode(True, reason="Billing")
		sub.status = "Suspended"
		sub.suspended_by_billing = 1
		sub.save(ignore_permissions=True)


def reactivate_subscription_on_payment(subscription_name: str):
	"""Helper for future Payment Entry hooks."""
	if not subscription_name or not frappe.db.exists("Site Subscription", subscription_name):
		return

	sub = frappe.get_doc("Site Subscription", subscription_name)
	if not int(sub.reactivate_on_payment or 0):
		return
	if sub.status != "Suspended" or not int(sub.suspended_by_billing or 0):
		return
	if not sub.site or not frappe.db.exists("Frappe Site", sub.site):
		return

	site = frappe.get_doc("Frappe Site", sub.site)
	site._set_maintenance_mode(False, reason="Billing")
	sub.status = "Active"
	sub.suspended_by_billing = 0
	sub.last_payment_date = nowdate()
	sub.save(ignore_permissions=True)
