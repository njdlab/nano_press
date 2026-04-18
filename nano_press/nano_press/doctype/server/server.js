// Copyright (c) 2025, Venkatesh M and contributors
// For license information, please see license.txt

frappe.ui.form.on('Server', {
	refresh(frm) {
		// avoid duplicate buttons
		if (frm.clear_custom_buttons) frm.clear_custom_buttons();

		// only add action buttons for saved docs
		if (!frm.is_new()) {
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
			const prog = open_server_progress_dialog(frm.doc.name, step_labels);
			prog.onhide = () => frm.reload_doc();

			// Call the unified prepare_server API
			frappe.call({
				method: 'nano_press.nano_press.doctype.server.server.prepare_server',
				args: {
					server_name: frm.doc.name,
					include_traefik: values.include_traefik,
				},
				callback: (r) => {
					if (r?.message?.status !== 'queued') {
						if (r?.message?.skipped) {
							prog.mark_info(__('Server is already prepared — no action needed.'));
						} else {
							prog.mark_failed(
								r?.message?.message || __('Failed to start server preparation.'),
							);
						}
					}
					frm.reload_doc();
				},
			});
		},
	});

	d.show();
}

function open_server_progress_dialog(doc_name, step_labels) {
	let completed = new Set();
	let current_step = step_labels[0];
	let active = true;
	let live_tasks = [];

	function render_steps() {
		return step_labels
			.map((s) => {
				let icon, cls;
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
					? `<div style="font-size:11px;color:#6c757d;white-space:pre-wrap;line-height:1.35;max-height:110px;overflow:auto;">${frappe.utils.escape_html(task.detail)}</div>`
					: '';
				return `<div class="np-live-task ${cls_by_state[state] || 'text-muted'}" style="padding:4px 0;border-top:1px solid #f1f3f5;">
					<div style="font-size:12px;"><span style="margin-right:8px;font-weight:bold;">${icon_by_state[state] || '&#9675;'}</span>${frappe.utils.escape_html(task.name)}</div>
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
				if (live_tasks[i].name === data.task_name && live_tasks[i].state === 'running') {
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
		$bar.css('width', (data.percent || 0) + '%').text((data.percent || 0) + '%');
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
			frappe.show_alert({ message: __('Server preparation failed!'), indicator: 'red' }, 5);
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
		if (data.status === 'running') {
			if (data.step && current_step && current_step !== data.step) {
				completed.add(current_step);
			}
			if (data.step) {
				current_step = data.step;
			}
		} else if (data.status === 'success') {
			step_labels.forEach((s) => completed.add(s));
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

	const cleanup = () => {
		active = false;
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

	return d;
}
