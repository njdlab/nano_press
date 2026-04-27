// Copyright (c) 2025, Venkatesh M and contributors
// For license information, please see license.txt

frappe.ui.form.on('Server', {
	refresh(frm) {
		// avoid duplicate buttons
		if (frm.clear_custom_buttons) frm.clear_custom_buttons();

		// only add action buttons for saved docs
		if (!frm.is_new()) {
			frm.add_custom_button(__('Cleanup Unused Space'), () => {
				frappe.confirm(
					__('This will remove unused Docker build cache, images, containers, and networks. Running workloads are not stopped. Continue?'),
					() => {
						frappe.call({
							method:
								'nano_press.nano_press.doctype.server.server.cleanup_server_storage',
							args: { server_name: frm.doc.name },
							freeze: true,
							freeze_message: __('Cleaning unused server space...'),
							timeout: 600,
							callback: (r) => {
								const msg = r?.message;
								if (!msg || !msg.ok) {
									frappe.msgprint({
										title: __('Cleanup Failed'),
										indicator: 'red',
										message:
											msg?.message || __('Could not clean unused space right now.'),
									});
									return;
								}

								const kb_to_gb = (kb) => {
									const n = Number(kb || 0);
									return (n / 1024 / 1024).toFixed(2);
								};

								const rows = [
									['Before disk usage', `${msg.before_percent || 'n/a'}%`],
									['After disk usage', `${msg.after_percent || 'n/a'}%`],
									['Freed on root disk', `${kb_to_gb(msg.reclaimed_kb)} GB`],
									['Builder cache prune', msg.docker_builder_prune || 'n/a'],
									['Image prune', msg.docker_image_prune || 'n/a'],
									['Container prune', msg.docker_container_prune || 'n/a'],
									['Network prune', msg.docker_network_prune || 'n/a'],
								];

								const table_html = rows
									.map(
										([label, value]) =>
											`<tr><td style="padding:4px 12px 4px 0;font-weight:600;">${label}</td><td style="padding:4px 0;">${frappe.utils.escape_html(String(value))}</td></tr>`,
									)
									.join('');

								frappe.msgprint({
									title: __('Cleanup Completed'),
									indicator: 'green',
									message: `<table style="border-collapse:collapse;">${table_html}</table>`,
								});

								frappe.show_alert({
									message: __('Unused space cleanup completed'),
									indicator: 'green',
								});
								frm.reload_doc();
							},
						error: (xhr) => {
							const responseText = String(xhr?.responseText || '');
							const isTimeout =
								xhr?.statusText === 'timeout' ||
								xhr?.status === 504 ||
								responseText.toLowerCase().includes('request timed out');

							if (isTimeout) {
								frappe.msgprint({
									title: __('Cleanup Still Running'),
									indicator: 'orange',
									message: __('Cleanup may still be running on the server. Please wait a bit and then check disk usage or click Refresh Metrics.'),
								});
								return;
							}

							frappe.msgprint({
								title: __('Cleanup Failed'),
								indicator: 'red',
								message: __('Could not clean unused space right now.'),
							});
						},
						});
					},
				);
			});

			frm.add_custom_button(__('Refresh Metrics'), () => {
				frappe.call({
					method:
						'nano_press.nano_press.doctype.server.server.refresh_server_metrics',
					args: { server_name: frm.doc.name },
					freeze: true,
					freeze_message: __('Collecting server metrics...'),
					callback: (r) => {
						if (r?.message?.ok) {
							frappe.show_alert({
								message: __('Metrics refreshed successfully'),
								indicator: 'green',
							});
						} else {
							frappe.msgprint({
								title: __('Metrics Refresh Failed'),
								indicator: 'red',
								message:
									r?.message?.health_reason ||
									r?.message?.message ||
									__('Unable to collect metrics right now.'),
							});
						}
						frm.reload_doc();
					},
				});
			});

			// Check real installation state on the remote server
			frm.add_custom_button(__('Check Status'), () => {
				frappe.show_alert({ message: __('Connecting to server…'), indicator: 'blue' });
				frappe.call({
					method: 'nano_press.nano_press.doctype.server.server.check_server_status',
					args: { server_name: frm.doc.name },
					freeze: true,
					freeze_message: __('Checking server status…'),
					callback: (r) => {
						const msg = r?.message;
						if (!msg) {
							frappe.show_alert({ message: __('No response from server.'), indicator: 'red' });
							return;
						}
						if (!msg.ok) {
							frappe.msgprint({
								title: __('Status Check Failed'),
								indicator: 'red',
								message: __('Could not reach the server via SSH. Verify connectivity and SSH key.'),
							});
							frm.reload_doc();
							return;
						}

						const rows = [
							['Docker', msg.docker_installed ? '✔ ' + msg.docker_version : '✘ Not installed'],
							['Docker Compose', msg.compose_installed ? '✔ ' + msg.compose_version : '✘ Not installed'],
							['Traefik', msg.traefik_deployed ? '✔ Running' + (msg.traefik_version ? ' (' + msg.traefik_version + ')' : '') : '✘ Not running'],
							['Status set to', msg.verify_status],
						];
						const table_html = rows.map(([label, value]) =>
							`<tr><td style="padding:4px 12px 4px 0;font-weight:600;">${label}</td>` +
							`<td style="padding:4px 0;">${frappe.utils.escape_html(value)}</td></tr>`
						).join('');

						frappe.msgprint({
							title: __('Server Status'),
							indicator: msg.verify_status === 'Prepared' ? 'green' : 'orange',
							message: `<table style="border-collapse:collapse;">${table_html}</table>`,
						});
						frm.reload_doc();
					},
				});
			});

			// Show Prepare Server button with option to include Traefik
			if (
				frm.doc.verify_status === 'Verified' ||
				frm.doc.verify_status === 'Prepared'
			) {
				// Only show Prepare when verified or already prepared
				frm
					.add_custom_button(__('Prepare Server'), () => {
						// Check if server is already prepared
						if (frm.doc.verify_status === 'Prepared') {
							frappe.confirm(
								__(
									'This server is already prepared. Do you want to prepare it again?',
								),
								() => {
									// User confirmed - show options dialog
									show_preparation_dialog(frm);
								},
								() => {
									// User cancelled - do nothing
									frappe.show_alert({
										message: __('Preparation cancelled'),
										indicator: 'orange',
									});
								},
							);
						} else {
							// Server is only verified, not prepared yet - show options directly
							show_preparation_dialog(frm);
						}
					})
					.addClass('btn-primary');
			} else {
				// Not verified yet → show Verify button
				frm
					.add_custom_button(__('Verify Server'), () => {
						frm.set_value('verify_status', 'Verifying');
						frappe.call({
							method: 'nano_press.utils.ansible_runner.ping_server',
							args: { server_name: frm.doc.name },
							callback: (r) => {
								if (r?.message) {
									if (r.message.status === 'success') {
										frappe.show_alert({
											message: __('Server verified'),
											indicator: 'green',
										});
									} else {
										frm.set_value('verify_status', 'Failed');
										frappe.show_alert({
											message: __('Verification failed'),
											indicator: 'red',
										});
									}
									frm.reload_doc();
								}
							},
						});
					})
					.addClass('btn-primary');
			}
		}

		// Render public key HTML & copy handler
		frappe.call({
			method: 'nano_press.nano_press.doctype.server.server.get_public_key_html',
			callback: (r) => {
				if (r?.message && frm.fields_dict.public_key) {
					frm.fields_dict.public_key.$wrapper.html(r.message);
					const btn = frm.fields_dict.public_key.$wrapper.find(
						'#copy-public-key-btn',
					);
					btn?.on('click', async () => {
						const text = frm.fields_dict.public_key.$wrapper
							.find('#server-public-key')
							.text();
						try {
							await navigator.clipboard.writeText(text);
						} catch (e) {
							const ta = document.createElement('textarea');
							ta.value = text;
							document.body.appendChild(ta);
							ta.select();
							document.execCommand('copy');
							document.body.removeChild(ta);
						}
						frappe.show_alert({
							message: __('Public key copied'),
							indicator: 'green',
						});
					});
				}
			},
		});
	},
});

// Helper function to show preparation options dialog
function show_preparation_dialog(frm) {
	const d = new frappe.ui.Dialog({
		title: __('Prepare Server'),
		fields: [
			{
				label: 'Preparation Options',
				fieldname: 'preparation_info',
				fieldtype: 'HTML',
				options: `
					<div class="alert alert-info">
						<strong>What will be installed:</strong>
						<ul>
							<li>Docker (if not already installed)</li>
							<li>Docker Compose (if not already installed)</li>
							<li>Traefik (optional - only if enabled below)</li>
						</ul>
						<small>The system will check for existing installations and skip them.</small>
					</div>
				`,
			},
			{
				label: 'Include Traefik',
				fieldname: 'include_traefik',
				fieldtype: 'Check',
				description: 'Also deploy Traefik reverse proxy with SSL support',
				default: 0,
				onchange: () => {
					// Show/hide Traefik fields based on checkbox
					const include = d.get_value('include_traefik');
					d.get_field('traefik_section').df.hidden = !include;
					d.refresh();
				},
			},
			{
				fieldname: 'traefik_section',
				fieldtype: 'Section Break',
				label: 'Traefik Configuration',
				hidden: 1,
			},
			{
				label: 'Domain',
				fieldname: 'traefik_domain',
				fieldtype: 'Data',
				reqd: 0,
				default: frm.doc.traefik_domain || '',
				description: 'Domain for Traefik dashboard (e.g., traefik.example.com)',
			},
			{
				label: 'Email',
				fieldname: 'traefik_email',
				fieldtype: 'Data',
				reqd: 0,
				default: frm.doc.traefik_email || '',
				description: "Email for Let's Encrypt SSL certificates",
			},
			{
				fieldname: 'col_break_1',
				fieldtype: 'Column Break',
			},
			{
				label: 'Username',
				fieldname: 'traefik_username',
				fieldtype: 'Data',
				reqd: 0,
				default: frm.doc.traefik_username || 'admin',
				description: 'Username for Traefik dashboard',
			},
			{
				label: 'Password',
				fieldname: 'traefik_password',
				fieldtype: 'Password',
				reqd: 0,
				default: frm.doc.traefik_password || '',
				description: 'Password for Traefik dashboard',
			},
		],
		primary_action_label: 'Prepare Server',
		primary_action(values) {
			// Validate Traefik fields if Traefik is enabled
			if (values.include_traefik) {
				if (
					!values.traefik_domain ||
					!values.traefik_email ||
					!values.traefik_username ||
					!values.traefik_password
				) {
					frappe.msgprint({
						title: __('Missing Information'),
						indicator: 'orange',
						message: __(
							'Please fill in all Traefik fields: Domain, Email, Username, and Password',
						),
					});
					return;
				}

				// Save Traefik fields to the form
				frm.set_value('traefik_domain', values.traefik_domain);
				frm.set_value('traefik_email', values.traefik_email);
				frm.set_value('traefik_username', values.traefik_username);
				frm.set_value('traefik_password', values.traefik_password);
			}

			d.hide();
			frm.set_value('verify_status', 'Preparing');

			// Open progress dialog BEFORE API call so we catch all realtime events
			const step_labels = values.include_traefik
				? ['Installing Docker & Compose', 'Deploying Traefik']
				: ['Installing Docker & Compose'];
			const prog = open_server_progress_dialog(
				frm.doc.name,
				step_labels,
				frm.doc.verify_status,
				frm.doc.last_prepared_at,
			);
			prog.onhide = () => frm.reload_doc();

			// Call the unified prepare_server API
			frappe.call({
				method: 'nano_press.nano_press.doctype.server.server.prepare_server',
				args: {
					server_name: frm.doc.name,
					include_traefik: values.include_traefik,
				},
				callback: (r) => {
					if (r?.message?.status === 'queued') {
						prog.set_queued_at(r?.message?.queued_at);
					} else {
						prog.mark_failed(
							r?.message?.message || __('Failed to start server preparation.'),
						);
					}
					frm.reload_doc();
				},
			});
		},
	});

	d.show();
}

function open_server_progress_dialog(
	doc_name,
	step_labels,
	initial_status,
	initial_last_prepared_at,
) {
	const completed = new Set();
	let current_step = step_labels[0];
	let active = true;
	let live_tasks = [];
	let poll_timer = null;
	let queued_at = null;

	function render_steps() {
		return step_labels
			.map((s) => {
				let icon;
				let cls;
				if (completed.has(s)) {
					icon = '&#10003;';
					cls = 'text-success';
				} else if (s === current_step) {
					icon = '&#8635;';
					cls = 'text-primary';
				} else {
					icon = '&#9675;';
					cls = 'text-muted';
				}
				return `<div class="np-step ${cls}" style="padding:3px 0;font-size:13px;">
					<span style="margin-right:8px;font-weight:bold;">${icon}</span>${s}
				</div>`;
			})
			.join('');
	}

	function render_live_tasks() {
		if (!live_tasks.length) {
			return `<div class="text-muted" style="font-size:12px;">Waiting for the first remote task...</div>`;
		}

		return live_tasks
			.slice(-8)
			.map((task) => {
				const icon_by_state = {
					running: '&#8635;',
					success: '&#10003;',
					failed: '&#10007;',
					skipped: '&#10134;',
					unreachable: '&#9888;',
				};
				const cls_by_state = {
					running: 'text-primary',
					success: 'text-success',
					failed: 'text-danger',
					skipped: 'text-muted',
					unreachable: 'text-warning',
				};
				const state = task.state || 'running';
				const detail = task.detail
					? `<div style="font-size:11px;color:#6c757d;white-space:pre-wrap;line-height:1.35;max-height:110px;overflow:auto;">${frappe.utils.escape_html(
							task.detail,
					  )}</div>`
					: '';
				return `<div class="np-live-task ${cls_by_state[state] || 'text-muted'}" style="padding:4px 0;border-top:1px solid #f1f3f5;">
					<div style="font-size:12px;"><span style="margin-right:8px;font-weight:bold;">${
						icon_by_state[state] || '&#9675;'
					}</span>${frappe.utils.escape_html(task.name)}</div>
					${detail}
				</div>`;
			})
			.join('');
	}

	function sync_live_task(data) {
		if (!data.task_name) return;

		if (data.task_state === 'running') {
			live_tasks.push({
				name: data.task_name,
				state: 'running',
				detail: data.task_detail || '',
			});
		} else {
			let matched = false;
			for (let i = live_tasks.length - 1; i >= 0; i -= 1) {
				if (
					live_tasks[i].name === data.task_name &&
					live_tasks[i].state === 'running'
				) {
					live_tasks[i] = {
						...live_tasks[i],
						state: data.task_state || 'success',
						detail: data.task_detail || data.message || '',
					};
					matched = true;
					break;
				}
			}

			if (!matched) {
				live_tasks.push({
					name: data.task_name,
					state: data.task_state || 'success',
					detail: data.task_detail || data.message || '',
				});
			}
		}

		if (live_tasks.length > 12) {
			live_tasks = live_tasks.slice(-12);
		}
	}

	const html = `
		<div style="padding:4px 0 8px;">
			<div class="np-steps" style="margin-bottom:14px;border-left:3px solid #d1d8dd;padding-left:12px;">
				${render_steps()}
			</div>
			<div class="progress" style="height:18px;margin-bottom:8px;">
				<div class="np-bar progress-bar progress-bar-striped progress-bar-animated"
				     role="progressbar" style="width:10%;transition:width 0.4s ease;font-size:11px;">10%</div>
			</div>
			<div class="np-msg" style="font-size:12px;color:#6c757d;margin-top:4px;">Waiting for worker...</div>
			<div style="margin-top:14px;">
				<div style="font-size:12px;font-weight:600;margin-bottom:6px;">Live Ansible Tasks</div>
				<div class="np-live-tasks" style="max-height:220px;overflow:auto;border:1px solid #e9ecef;border-radius:6px;padding:0 10px;background:#fff;">
					${render_live_tasks()}
				</div>
			</div>
		</div>
	`;

	const d = new frappe.ui.Dialog({
		title: __('Preparing Server'),
		fields: [{ fieldname: 'body', fieldtype: 'HTML', options: html }],
	});
	d.get_close_btn().hide();
	d.show();

	function update_ui(data) {
		const $bar = d.$wrapper.find('.np-bar');
		const $msg = d.$wrapper.find('.np-msg');
		const $steps = d.$wrapper.find('.np-steps');
		const $tasks = d.$wrapper.find('.np-live-tasks');
		sync_live_task(data);
		$bar.css('width', `${data.percent || 0}%`).text(`${data.percent || 0}%`);
		if (data.message) $msg.text(data.message);
		$steps.html(render_steps());
		$tasks.html(render_live_tasks());
		if (data.status === 'success') {
			$bar
				.removeClass('progress-bar-striped progress-bar-animated')
				.css('background-color', '#28a745')
				.text('Done!');
			$msg.css('color', '#28a745');
			setTimeout(() => d.get_close_btn().show(), 500);
			frappe.show_alert(
				{ message: __('Server prepared successfully!'), indicator: 'green' },
				5,
			);
		} else if (data.status === 'failed') {
			$bar
				.removeClass('progress-bar-striped progress-bar-animated')
				.css('background-color', '#dc3545')
				.text('Failed');
			$msg.css('color', '#dc3545');
			d.get_close_btn().show();
			frappe.show_alert(
				{ message: __('Server preparation failed!'), indicator: 'red' },
				5,
			);
		} else if (data.status === 'info') {
			$bar
				.removeClass('progress-bar-striped progress-bar-animated')
				.css('background-color', '#17a2b8')
				.text('OK');
			d.get_close_btn().show();
		}
	}

	const on_event = (data) => {
		if (!active) return;
		if (data.doc_name !== doc_name || data.doc_type !== 'Server') return;
		if (data.queued_at) {
			queued_at = data.queued_at;
		}
		if (data.status === 'running') {
			if (data.step && current_step && current_step !== data.step) {
				completed.add(current_step);
			}
			if (data.step) {
				current_step = data.step;
			}
		} else if (data.status === 'success') {
			for (const s of step_labels) {
				completed.add(s);
			}
			current_step = null;
			active = false;
		} else if (data.status === 'failed') {
			current_step = null;
			active = false;
		}
		update_ui(data);
		if (!active) {
			frappe.realtime.off('nano_press:progress', on_event);
		}
	};

	frappe.realtime.on('nano_press:progress', on_event);

	const check_server_status = () => {
		if (!active) return;
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Server',
				filters: { name: doc_name },
				fieldname: ['verify_status', 'last_prepared_at'],
			},
			callback: (r) => {
				if (!active) return;
				const value = r?.message || {};
				const verify_status = value.verify_status;
				const last_prepared_at = value.last_prepared_at || null;
				const queued_at_ms = queued_at ? Date.parse(queued_at) : NaN;
				const prepared_at_ms = last_prepared_at ? Date.parse(last_prepared_at) : NaN;
				const prepared_in_this_run =
					verify_status === 'Prepared' &&
					Number.isFinite(queued_at_ms) &&
					Number.isFinite(prepared_at_ms) &&
					prepared_at_ms >= queued_at_ms;

				if (prepared_in_this_run) {
					on_event({
						doc_name,
						doc_type: 'Server',
						step: 'Complete',
						percent: 100,
						status: 'success',
						message: __('Server prepared successfully!'),
					});
					return;
				}

				if (verify_status === 'Failed') {
					on_event({
						doc_name,
						doc_type: 'Server',
						step: 'Failed',
						percent: 0,
						status: 'failed',
						message: __('Server preparation failed.'),
					});
				}
			},
		});
	};

	poll_timer = setInterval(check_server_status, 3000);

	const cleanup = () => {
		active = false;
		if (poll_timer) {
			clearInterval(poll_timer);
			poll_timer = null;
		}
		frappe.realtime.off('nano_press:progress', on_event);
	};
	const _orig = d.onhide;
	d.onhide = () => {
		cleanup();
		if (_orig) _orig();
	};

	d.mark_failed = (msg) => {
		on_event({
			doc_name,
			doc_type: 'Server',
			step: 'Failed',
			percent: 0,
			status: 'failed',
			message: msg,
		});
	};
	d.mark_info = (msg) => {
		update_ui({ percent: 100, status: 'info', message: msg });
	};
	d.set_queued_at = (value) => {
		queued_at = value || queued_at;
	};

	return d;
}
