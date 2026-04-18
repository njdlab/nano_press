from __future__ import annotations

import json
import os
import time
from typing import Any

from ansible.plugins.callback import CallbackBase


class CallbackModule(CallbackBase):
	CALLBACK_VERSION = 2.0
	CALLBACK_TYPE = "notification"
	CALLBACK_NAME = "nano_press_progress"
	CALLBACK_NEEDS_ENABLED = True

	def __init__(self) -> None:
		super().__init__()
		self.event_file = os.environ.get("NANO_PRESS_EVENT_FILE")

	def v2_playbook_on_task_start(self, task, is_conditional):
		self._write_event(
			{
				"event": "task_start",
				"task_name": task.get_name().strip(),
				"task_action": getattr(task, "action", None),
			}
		)

	def v2_runner_on_ok(self, result, **kwargs):
		self._write_result("success", result)

	def v2_runner_on_failed(self, result, ignore_errors=False):
		self._write_result("failed", result, ignore_errors=ignore_errors)

	def v2_runner_on_skipped(self, result):
		self._write_result("skipped", result)

	def v2_runner_on_unreachable(self, result):
		self._write_result("unreachable", result)

	@staticmethod
	def _coerce_str(value: Any) -> str:
		"""Normalize Ansible result values that may be list or None to a plain string."""
		if isinstance(value, list):
			return "\n".join(str(v) for v in value)
		return str(value) if value is not None else ""

	def _write_result(self, status: str, result, **extra: Any):
		payload = {
			"event": "task_result",
			"status": status,
			"task_name": result._task.get_name().strip(),
			"host": result._host.get_name(),
			"changed": bool(result._result.get("changed")),
			"stdout": self._coerce_str(result._result.get("stdout", "")),
			"stderr": self._coerce_str(result._result.get("stderr", "")),
			"msg": self._coerce_str(result._result.get("msg", "")),
			"rc": result._result.get("rc"),
		}
		payload.update(extra)
		self._write_event(payload)

	def _write_event(self, payload: dict[str, Any]):
		if not self.event_file:
			return
		payload = {**payload, "timestamp": time.time()}
		with open(self.event_file, "a", encoding="utf-8") as handle:
			handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
			handle.flush()