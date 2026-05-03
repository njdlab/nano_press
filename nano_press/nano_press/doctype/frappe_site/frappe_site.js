frappe.ui.form.on('Frappe Site', {
	setup(frm) {
		set_custom_image_query(frm);
	},

	onload(frm) {
		if (frm.__np_onload_refresh_done || frm.is_new()) return;
		frm.__np_onload_refresh_done = true;
		setTimeout(() => {
			if (frm.doc?.name) {
				frm.refresh();
			}
		}, 0);
	},

	onload_post_render(frm) {
		if (frm.__np_post_render_refresh_done || frm.is_new()) return;
		frm.__np_post_render_refresh_done = true;
		setTimeout(() => {
			if (frm.doc?.name) {
				frm.refresh();
			}
		}, 100);
	},

	refresh(frm) {
		set_custom_image_query(frm);
		frm.set_df_property('admin_password', 'hidden', 0);
		frm.set_df_property('admin_password', 'read_only', 0);
		frm.clear_custom_buttons();
		frm.set_intro('');

		const status = (frm.doc.status || '').trim();
		if (!status && !frm.is_new() && frm.doc.name && !frm.__loading_status_for_buttons) {
			frm.__loading_status_for_buttons = true;
			frappe.db
				.get_value('Frappe Site', frm.doc.name, ['status'])
				.then((r) => {
					const fresh_status = (r?.message?.status || '').trim();
					if (fresh_status && fresh_status !== (frm.doc.status || '').trim()) {
						frm.doc.status = fresh_status;
					}
					frm.refresh();
				})
				.finally(() => {
					frm.__loading_status_for_buttons = false;
				});
			return;
		}

		if (!frm.is_new()) {
			sync_site_runtime(frm);
		}

		if (status === 'Not Deployed') {
			frm
				.add_custom_button(__('Prepare for Deployment'), () =>
					start_prepare_deployment(frm),
				)
				.addClass('btn-primary');
			frm.set_intro(
				__('Not deployed yet. Prepare deployment first, then deploy.'),
				'orange',
			);
		} else if (status === 'Ready To Deploy') {
			frm
				.add_custom_button(__('Deploy Site'), () =>
					start_deploy_site(frm, { force_redeploy: 0 }),
				)
				.addClass('btn-primary');
		} else if (status === 'Deploying') {
			frm
				.add_custom_button(__('Check Status'), () => start_check_status(frm))
				.addClass('btn-primary');
			frm.add_custom_button(
				__('Restart Containers'),
				() => start_restart_site(frm),
				__('Actions'),
			);
			frm.set_intro(
				__('Deployment is in progress. You can check status while the worker completes the run.'),
				'orange',
			);
		} else if (status === 'Deployed') {
			frm.add_custom_button(
				__('Stop Containers'),
				() => start_stop_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Restart Containers'),
				() => start_restart_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Backup Site'),
				() => start_backup_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Restore Site'),
				() => start_restore_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Manage Backups'),
				() => start_manage_backups(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Suspend Site'),
				() => start_suspend_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Unsuspend Site'),
				() => start_unsuspend_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Reset Admin Password'),
				() => start_reset_admin_password(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Install App'),
				() => start_install_app(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Uninstall App'),
				() => start_uninstall_app(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Redeploy Site'),
				() => {
					frappe.confirm(
						__('Are you sure you want to redeploy the site?'),
						() => start_deploy_site(frm, { force_redeploy: 1 }),
					);
				},
				__('Actions'),
			);
			frm.add_custom_button(
				__('Collect Storage Usage'),
				() => start_collect_storage(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Destroy Site'),
				() => {
					frappe.confirm(
						__(
							'Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.',
						),
						() => start_remove_site(frm),
					);
				},
				__('Actions'),
			);
			frm
				.add_custom_button(__('Visit Site'), () =>
					window.open(`https://${frm.doc.site_url}`),
				)
				.addClass('btn-info');
			frm.set_intro(
				`The site has been successfully deployed and will soon be accessible at:
        <strong>https://${frm.doc.site_url}</strong>.
        Please note that deployment time may vary depending on the number of applications being installed.
        Typically, the first app becomes available within 5 minutes.
        If the site remains inaccessible after 10 minutes, you are advised to restart the containers.`,
				'yellow',
			);
		} else if (status === 'Stopped') {
			frm
				.add_custom_button(__('Start Containers'), () =>
					start_restart_site(frm),
				)
				.addClass('btn-primary');
			frm.add_custom_button(
				__('Manage Backups'),
				() => start_manage_backups(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Deploy Site'),
				() => start_deploy_site(frm, { force_redeploy: 0 }),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Destroy Site'),
				() => {
					frappe.confirm(
						__(
							'Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.',
						),
						() => start_remove_site(frm),
					);
				},
				__('Actions'),
			);
		} else if (status === 'Failed') {
			frm
				.add_custom_button(__('Check Status'), () => start_check_status(frm))
				.addClass('btn-primary');
			frm.add_custom_button(
				__('Retry Deployment'),
				() => start_prepare_deployment(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Restart Containers'),
				() => start_restart_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Stop Containers'),
				() => start_stop_site(frm),
				__('Actions'),
			);
			frm.add_custom_button(
				__('Redeploy Site'),
				() => {
					frappe.confirm(
						__('Are you sure you want to redeploy the site?'),
						() => start_deploy_site(frm, { force_redeploy: 1 }),
					);
				},
				__('Actions'),
			);
			frm.add_custom_button(
				__('Destroy Site'),
				() => {
					frappe.confirm(
						__(
							'Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.',
						),
						() => start_remove_site(frm),
					);
				},
				__('Actions'),
			);
			frm.set_intro(
				__(
					'Last action failed. Click Check Status to detect the current state of the site and restore the correct actions.',
				),
				'red',
			);
		}

		if (!frm.doc.ssl_enabled && frm.doc.server_name) {
			frappe.db.get_doc('Server', frm.doc.server_name).then((server) => {
				const ip = server.server_ip || 'localhost';
				frm
					.add_custom_button(__('Visit Site (Insecure)'), () =>
						window.open(`http://${ip}:8080`),
					)
					.addClass('btn-warning');
			});
		}

		// Storage usage bar (shown when quota is set)
		render_storage_bar(frm);

		// (Re)bind clipboard handlers safely on every refresh
		bind_clipboard_handlers(frm);

		// Some first-load routes mount the toolbar slightly after refresh.
		// Trigger one deferred refresh so action buttons are consistently rendered.
		if (!frm.__deferred_actions_refresh_done && !frm.is_new()) {
			frm.__deferred_actions_refresh_done = true;
			setTimeout(() => {
				if (frm.doc?.name) {
					frm.refresh();
				}
			}, 120);
		}
	},

	server_name(frm) {
		set_custom_image_query(frm);
		clear_mismatched_custom_image(frm);
	},

	is_custom(frm) {
		set_custom_image_query(frm);
		if (!frm.doc.is_custom) {
			frm.set_value('custom_image', null);
		}
	},

	custom_image(frm) {
		clear_mismatched_custom_image(frm);
	},
});

function set_custom_image_query(frm) {
	frm.set_query('custom_image', () => {
		const filters = {
			build_status: 'Built',
		};

		if (frm.doc.server_name) {
			filters.server_name = frm.doc.server_name;
		}

		return { filters };
	});
}

function render_storage_bar(frm) {
	const quota = frm.doc.storage_quota_gb || 0;
	const used = frm.doc.storage_used_gb || 0;
	const checked_at = frm.doc.storage_last_checked_at || '';

	// Remove previous bar if any
	frm.fields_dict.storage_used_gb &&
		$(frm.fields_dict.storage_used_gb.wrapper)
			.find('.np-storage-bar-wrapper')
			.remove();

	if (!quota) return;

	const percent = Math.min(100, (used / quota) * 100);
	const bar_class =
		percent >= 90
			? 'progress-bar-danger'
			: percent >= 80
				? 'progress-bar-warning'
				: 'progress-bar-success';

	const checked_label = checked_at
		? frappe.datetime.str_to_user(checked_at)
		: __('Never');

	const bar_html = `
		<div class="np-storage-bar-wrapper" style="margin-top:6px;">
			<div class="progress" style="height:14px;margin-bottom:4px;" title="${used.toFixed(3)} GB used of ${quota} GB">
				<div class="progress-bar ${bar_class}"
					role="progressbar"
					style="width:${percent.toFixed(1)}%;min-width:2em;font-size:11px;line-height:14px;">
					${percent.toFixed(1)}%
				</div>
			</div>
			<small class="text-muted">
				${used.toFixed(3)} GB used / ${quota} GB quota &mdash; checked: ${checked_label}
			</small>
		</div>`;

	frm.fields_dict.storage_used_gb &&
		$(frm.fields_dict.storage_used_gb.wrapper).append(bar_html);
}

function start_collect_storage(frm) {
	frappe.show_alert({ message: __('Collecting storage usage...'), indicator: 'blue' });
	frappe.call({
		method: 'collect_storage_usage',
		doc: frm.doc,
		callback(r) {
			if (r.exc) {
				frappe.msgprint({
					title: __('Error'),
					message: __('Storage collection failed. Check Error Log for details.'),
					indicator: 'red',
				});
				return;
			}
			const msg = r.message || {};
			const used = (msg.storage_used_gb || 0).toFixed(3);
			const files_mb = ((msg.files_bytes || 0) / (1024 * 1024)).toFixed(1);
			const db_mb = ((msg.db_bytes || 0) / (1024 * 1024)).toFixed(1);
			frappe.msgprint({
				title: __('Storage Usage'),
				message: `
					<b>${used} GB</b> total used<br>
					Files: ${files_mb} MB &nbsp;|&nbsp; Database: ${db_mb} MB
				`,
				indicator: 'green',
			});
			frm.reload_doc();
		},
	});
}

function clear_mismatched_custom_image(frm) {
	if (!frm.doc.is_custom || !frm.doc.custom_image || !frm.doc.server_name) {
		return;
	}

	frappe.db
		.get_value('Custom Image', frm.doc.custom_image, [
			'server_name',
			'build_status',
		])
		.then((r) => {
			const info = r?.message || {};
			const image_server = info.server_name;
			const build_status = info.build_status;

			if (build_status && build_status !== 'Built') {
				frappe.msgprint({
					title: __('Invalid Custom Image'),
					message: __('Selected custom image is not built yet.'),
					indicator: 'orange',
				});
				frm.set_value('custom_image', null);
				return;
			}

			if (image_server && image_server !== frm.doc.server_name) {
				frappe.msgprint({
					title: __('Server Mismatch'),
					message: __(
						'Custom image is built on server {0}, but this site uses server {1}. Please select a custom image built on the same server.',
						[image_server, frm.doc.server_name],
					),
					indicator: 'orange',
				});
				frm.set_value('custom_image', null);
			}
		});
}

function bind_clipboard_handlers(frm) {
	const hasCreds = frm.doc.admin_password && frm.doc.username;
	const pwdField = frm.fields_dict.admin_password;
	const userField = frm.fields_dict.username;
	if (!hasCreds || !pwdField || !userField) return;

	// Set labels once per form lifetime
	if (!pwdField._label_patched) {
		pwdField.set_label(
			'Admin Password - <span class="fa fa-clipboard" title="Copy to Clipboard"></span>',
		);
		userField.set_label(
			'Admin Username - <span class="fa fa-clipboard" title="Copy to Clipboard"></span>',
		);
		pwdField._label_patched = true;
		userField._label_patched = true;
	}

	// Always remove old handlers before adding new ones (use event namespaces)
	$(pwdField.label_area)
		.off('click.copy') // prevent duplicates
		.on('click.copy', () => {
			frappe.call({
				method: 'nano_press.get_admin_password',
				args: { site_name: frm.doc.name },
				callback: (r) => {
					const val = r?.message;
					if (val) {
						navigator.clipboard
							.writeText(val)
							.then(() =>
								frappe.show_alert(__('Admin password copied to clipboard!')),
							)
							.catch((error) =>
								frappe.show_alert(__('Error copying password: {0}', [error])),
							);
					} else {
						frappe.show_alert(__('Could not retrieve admin password.'));
					}
				},
			});
		});

	$(userField.label_area)
		.off('click.copy')
		.on('click.copy', () => {
			navigator.clipboard
				.writeText(frm.doc.username)
				.then(() => frappe.show_alert(__('Username copied to clipboard!')))
				.catch((error) =>
					frappe.show_alert(__('Error copying username: {0}', [error])),
				);
		});
}

function start_prepare_deployment(frm) {
	if (!frm.doc.name) {
		frappe.msgprint(__('Please save the document before proceeding.'));
		return;
	}

	const d = open_progress_dialog(
		__('Preparing for Deployment'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Preparing repository', 'Rendering compose file'],
		{
			success_message: __('Deployment preparation complete!'),
			poll_interval: 4000,
			poll_status: async ({ queued_at }) => {
				try {
					const parseServerDate = (value) => {
						if (!value) return NaN;
						const normalized = String(value).trim().replace(' ', 'T');
						return Date.parse(normalized);
					};

					const value_response = await frappe.call({
						method: 'frappe.client.get_value',
						args: {
							doctype: 'Frappe Site',
							filters: { name: frm.doc.name },
							fieldname: ['status', 'last_deployed_at'],
						},
					});

					const value = value_response?.message || {};
					const status = value.status;
					const queued_at_ms = parseServerDate(queued_at);
					const prepared_at_ms = parseServerDate(value.last_deployed_at);

					if (status === 'Failed') {
						return {
							status: 'failed',
							step: 'Failed',
							percent: 0,
							message: __('Deployment preparation failed.'),
						};
					}

					const prepared_in_this_run =
						status === 'Ready To Deploy' &&
						Number.isFinite(queued_at_ms) &&
						Number.isFinite(prepared_at_ms) &&
						prepared_at_ms >= queued_at_ms;

					if (prepared_in_this_run) {
						return {
							status: 'success',
							step: 'Complete',
							percent: 100,
							message: __('Deployment preparation complete!'),
						};
					}

					if (status === 'Deploying') {
						return {
							status: 'running',
							step: 'Preparing repository',
							percent: 15,
							message: __('Worker is preparing repository and compose files...'),
						};
					}

					return null;
				} catch (e) {
					return null;
				}
			},
		},
	);
	d.onhide = () => frm.reload_doc();

	frm
		.call('prepare_for_deployment')
		.then((r) => {
			if (r?.message?.status === 'queued' && r?.message?.queued_at) {
				d.set_queued_at(r.message.queued_at);
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(
					r?.message?.message || __('Failed to start deployment preparation.'),
				);
			}
		})
		.catch((err) => {
			d.mark_failed(err?.message || __('Request failed.'));
		});
}

function start_deploy_site(frm, opts = {}) {
	if (!frm.doc.name) {
		frappe.msgprint(__('Please save the document before proceeding.'));
		return;
	}
	const force_redeploy = opts.force_redeploy ? 1 : 0;

	const d = open_progress_dialog(
		force_redeploy ? __('Redeploying Site') : __('Deploying Site'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Deploying containers'],
		{
			success_message: force_redeploy
				? __('Site redeployed successfully.')
				: __('Site deployed successfully.'),
			poll_interval: 8000,
			poll_status: async ({ queued_at }) => {
				try {
					const parseServerDate = (value) => {
						if (!value) return NaN;
						const normalized = String(value).trim().replace(' ', 'T');
						return Date.parse(normalized);
					};

					const EXPECTED_CORE_CONTAINERS = 9;
					const value_response = await frappe.call({
						method: 'frappe.client.get_value',
						args: {
							doctype: 'Frappe Site',
							filters: { name: frm.doc.name },
							fieldname: ['status', 'last_deployed_at'],
						},
					});

					const value = value_response?.message || {};
					const status = value.status;
					const last_deployed_at = value.last_deployed_at || null;

					if (status === 'Failed') {
						return {
							status: 'failed',
							step: 'Failed',
							percent: 0,
							message: __('Site deployment failed.'),
						};
					}

					const queued_at_ms = parseServerDate(queued_at);
					const deployed_at_ms = parseServerDate(last_deployed_at);
					const deployed_in_this_run =
						status === 'Deployed' &&
						Number.isFinite(queued_at_ms) &&
						Number.isFinite(deployed_at_ms) &&
						deployed_at_ms >= queued_at_ms;

					if (deployed_in_this_run) {
						return {
							status: 'success',
							step: 'Complete',
							percent: 100,
							message: __('Site is healthy. Deployment complete.'),
						};
					}

					if (status === 'Deploying') {
						try {
							const runtime_response = await frappe.call({
								method:
									'nano_press.nano_press.doctype.frappe_site.frappe_site.get_runtime_progress',
								args: { site_name: frm.doc.name },
							});
							const runtime = runtime_response?.message?.runtime || {};
							const running_count = Math.max(
								0,
								Math.min(
									EXPECTED_CORE_CONTAINERS,
									cint(runtime.containers_running || 0),
								),
							);

							if (running_count > 0) {
								const percent = Math.max(10, Math.min(90, running_count * 10));
								return {
									status: 'running',
									step: 'Deploying containers',
									percent,
									message: running_count >= EXPECTED_CORE_CONTAINERS
										? __('All core containers are up. Waiting for final deploy state...')
										: __('Running core containers: {0}/{1}', [running_count, EXPECTED_CORE_CONTAINERS]),
								};
							}
						} catch (e) {
							// Ignore fallback runtime polling errors.
						}

						return {
							status: 'running',
							step: 'Deploying containers',
							percent: 10,
							message: __('Worker is still processing deployment...'),
						};
					}

					return null;
				} catch (e) {
					return null;
				}
			},
		},
	);
	d.onhide = () => frm.reload_doc();

	frm
		.call('deploy_site', { force_redeploy })
		.then((r) => {
			if (r?.message?.status === 'already_running') {
				d.mark_info(
					__(
						'Site is already running. Use Redeploy Site if you want to recreate containers.',
					),
				);
				frm.reload_doc();
				return;
			}
			if (r?.message?.status === 'queued' && r?.message?.queued_at) {
				d.set_queued_at(r.message.queued_at);
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(
					r?.message?.message || __('Failed to start site deployment.'),
				);
			}
		})
		.catch((err) => {
			d.mark_failed(err?.message || __('Request failed.'));
		});
}

function open_progress_dialog(
	title,
	frm,
	doc_name,
	doc_type,
	step_labels,
	opts = {},
) {
	const completed = new Set();
	let current_step = step_labels[0];
	let active = true;
	let live_tasks = [];
	let success_handled = false;
	let poll_timer = null;
	let queued_at = opts.queued_at || null;

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
				     role="progressbar" style="width:5%;transition:width 0.4s ease;font-size:11px;">5%</div>
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
		title,
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
			frm.reload_doc();
			setTimeout(() => d.get_close_btn().show(), 500);
			frappe.show_alert(
				{
					message: opts.success_message || __('Operation completed!'),
					indicator: 'green',
				},
				5,
			);
			if (!success_handled && typeof opts.on_success === 'function') {
				success_handled = true;
				opts.on_success(data);
			}
		} else if (data.status === 'failed') {
			$bar
				.removeClass('progress-bar-striped progress-bar-animated')
				.css('background-color', '#dc3545')
				.text('Failed');
			$msg.css('color', '#dc3545');
			d.get_close_btn().show();
			frm.reload_doc();
			frappe.show_alert(
				{
					message: opts.failed_message || __('Operation failed!'),
					indicator: 'red',
				},
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
		if (data.doc_name !== doc_name || data.doc_type !== doc_type) return;
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
			if (poll_timer) {
				clearInterval(poll_timer);
				poll_timer = null;
			}
			frappe.realtime.off('nano_press:progress', on_event);
		}
	};

	frappe.realtime.on('nano_press:progress', on_event);

	if (typeof opts.poll_status === 'function') {
		const run_poll = () => {
			if (!active) return;
			Promise.resolve(opts.poll_status({ queued_at }))
				.then((data) => {
					if (!active || !data) return;
					on_event({
						doc_name,
						doc_type,
						...data,
					});
				})
				.catch(() => {
					// Ignore polling failures; realtime stream remains the primary source.
				});
		};

		poll_timer = setInterval(run_poll, opts.poll_interval || 3000);
	}

	const _original_onhide = d.onhide;
	const cleanup = () => {
		active = false;
		if (poll_timer) {
			clearInterval(poll_timer);
			poll_timer = null;
		}
		frappe.realtime.off('nano_press:progress', on_event);
		if (_original_onhide) _original_onhide();
	};
	d.onhide = cleanup;

	d.mark_failed = (msg) => {
		on_event({
			doc_name,
			doc_type,
			step: 'Failed',
			percent: 0,
			status: 'failed',
			message: msg,
		});
	};

	d.mark_info = (msg) => {
		update_ui({ percent: 100, status: 'info', message: msg });
		d.get_close_btn().show();
	};

	d.set_queued_at = (value) => {
		queued_at = value || queued_at;
	};

	d.get_queued_at = () => queued_at;

	return d;
}

function show_backup_ready_dialog(data) {
	const files = data?.backup_files || [];
	const remoteDir = data?.backup_directory || '';
	const escapedDir = remoteDir ? frappe.utils.escape_html(remoteDir) : '';
	const links = files.length
		? files
				.map((file) => {
					const label = frappe.utils.escape_html(
						file.label || file.file_name || __('Backup File'),
					);
					const name = frappe.utils.escape_html(file.file_name || '');
					const href = encodeURI(file.file_url || '#');
					return `<div style="padding:8px 0;border-top:1px solid #f1f3f5;">
						<div style="font-size:12px;font-weight:600;">${label}</div>
						<div style="font-size:12px;color:#6c757d;">${name}</div>
						<div style="margin-top:4px;"><a href="${href}" target="_blank">${__(
							'Download',
						)}</a></div>
					</div>`;
				})
				.join('')
		: `<div class="text-muted" style="font-size:12px;">${__(
				'No downloadable files were registered for this backup.',
		  )}</div>`;

	frappe.msgprint({
		title: __('Backup Ready'),
		wide: true,
		message: `
			<div>
				${
					escapedDir
						? `<div style="font-size:12px;margin-bottom:10px;">${__(
								'Saved on server at',
						  )}:<br><code>${escapedDir}</code></div>`
						: ''
				}
				<div>${links}</div>
			</div>
		`,
	});
}

function open_restore_site_dialog(frm, backupCatalog) {
	const backups = backupCatalog?.backups || [];
	const rootDirectory = backupCatalog?.root_directory || '';
	const backupOptions = backups.map((item) => item.directory);
	const backupMap = new Map(backups.map((item) => [item.directory, item]));
	const defaultMode = backupOptions.length
		? 'server_directory'
		: 'uploaded_files';

	const dialog = new frappe.ui.Dialog({
		title: __('Restore Site Backup'),
		fields: [
			{
				fieldname: 'restore_mode',
				label: __('Restore From'),
				fieldtype: 'Select',
				options: 'server_directory\nuploaded_files',
				default: defaultMode,
				reqd: 1,
			},
			{
				fieldname: 'server_backup_help',
				fieldtype: 'HTML',
			},
			{
				fieldname: 'backup_directory',
				label: __('Server Backup Directory'),
				fieldtype: 'Select',
				options: [''].concat(backupOptions).join('\n'),
				default: backupOptions[0] || '',
			},
			{
				fieldname: 'backup_directory_preview',
				fieldtype: 'HTML',
			},
			{
				fieldname: 'upload_help',
				fieldtype: 'HTML',
			},
			{
				fieldname: 'db_file_url',
				label: __('Database Backup File'),
				fieldtype: 'Attach',
			},
			{
				fieldname: 'public_file_url',
				label: __('Public Files Backup File'),
				fieldtype: 'Attach',
			},
			{
				fieldname: 'private_file_url',
				label: __('Private Files Backup File'),
				fieldtype: 'Attach',
			},
		],
		primary_action_label: __('Start Restore'),
		primary_action(values) {
			const restoreMode = values.restore_mode;
			if (restoreMode === 'server_directory' && !values.backup_directory) {
				frappe.msgprint(
					__('Choose a backup directory from the server backups list.'),
				);
				return;
			}

			if (
				restoreMode === 'uploaded_files' &&
				(!values.db_file_url ||
					!values.public_file_url ||
					!values.private_file_url)
			) {
				frappe.msgprint(
					__(
						'Upload database, public files and private files backups before restoring.',
					),
				);
				return;
			}

			frappe.confirm(
				__(
					'Restore will overwrite current site data. Are you sure you want to continue?',
				),
				() => {
					let restore_run_id = null;
					dialog.hide();
					const stepLabels =
						restoreMode === 'uploaded_files'
							? [
									__('Preparing backup operation'),
									__('Preparing restore files'),
									__('Starting restore command'),
									__('Running restore command'),
							  ]
							: [
									__('Preparing backup operation'),
									__('Validating restore files'),
									__('Starting restore command'),
									__('Running restore command'),
							  ];

					const progress = open_progress_dialog(
						__('Restoring Site Backup'),
						frm,
						frm.doc.name,
						'Frappe Site',
						stepLabels,
						{
							success_message: __('Site restore completed successfully.'),
							poll_interval: 4000,
							poll_status: async () => {
								try {
									if (!restore_run_id) return null;
									const progress_response = await frappe.call({
										method:
											'nano_press.nano_press.doctype.frappe_site.frappe_site.get_site_action_progress',
										args: {
											site_name: frm.doc.name,
											action: 'restore',
											run_id: restore_run_id,
										},
									});
									return progress_response?.message || null;
								} catch (e) {
									console.error('Restore polling error:', e);
									return null;
								}
							},
						},
					);
					progress.onhide = () => frm.reload_doc();

					frm
						.call('restore_site_backup', {
							restore_mode: restoreMode,
							backup_directory: values.backup_directory || '',
							db_file_url: values.db_file_url || '',
							public_file_url: values.public_file_url || '',
							private_file_url: values.private_file_url || '',
						})
						.then((r) => {
							if (r?.message?.status === 'queued' && r?.message?.run_id) {
								restore_run_id = r.message.run_id;
							}
							if (r?.message?.status !== 'queued') {
								progress.mark_failed(
									r?.message?.message || __('Failed to start site restore.'),
								);
							}
						})
						.catch((err) =>
							progress.mark_failed(err?.message || __('Request failed.')),
						);
				},
			);
		},
	});

	function updateModeUI() {
		const restoreMode = dialog.get_value('restore_mode') || defaultMode;
		const useServerDirectory = restoreMode === 'server_directory';

		dialog.set_df_property('backup_directory', 'hidden', !useServerDirectory);
		dialog.set_df_property(
			'backup_directory_preview',
			'hidden',
			!useServerDirectory,
		);
		dialog.set_df_property('server_backup_help', 'hidden', !useServerDirectory);
		dialog.set_df_property('db_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('public_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('private_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('upload_help', 'hidden', useServerDirectory);
		dialog.set_df_property(
			'backup_directory',
			'reqd',
			useServerDirectory ? 1 : 0,
		);
		dialog.set_df_property('db_file_url', 'reqd', useServerDirectory ? 0 : 1);
		dialog.set_df_property(
			'public_file_url',
			'reqd',
			useServerDirectory ? 0 : 1,
		);
		dialog.set_df_property(
			'private_file_url',
			'reqd',
			useServerDirectory ? 0 : 1,
		);

		dialog.fields_dict.server_backup_help.$wrapper.html(
			useServerDirectory
				? `<div class="text-muted" style="font-size:12px;margin-bottom:10px;">${__(
						'Choose a timestamped backup directory from the target server.',
				  )}${
						rootDirectory
							? `<br>${__('Root directory')}: <code>${frappe.utils.escape_html(
									rootDirectory,
							  )}</code>`
							: ''
				  }</div>`
				: '',
		);

		dialog.fields_dict.upload_help.$wrapper.html(
			!useServerDirectory
				? `<div class="text-muted" style="font-size:12px;margin-bottom:10px;">${__(
						'Upload the three backup artifacts to restore this site.',
				  )}</div>`
				: '',
		);

		updateBackupDirectoryPreview();
	}

	function updateBackupDirectoryPreview() {
		const selected = dialog.get_value('backup_directory') || '';
		const backup = backupMap.get(selected);
		if (!backup) {
			dialog.fields_dict.backup_directory_preview.$wrapper.html(
				`<div class="text-muted" style="font-size:12px;">${__(
					'No backup directory selected.',
				)}</div>`,
			);
			return;
		}

		const files = (backup.files || [])
			.map(
				(file) =>
					`<div style="font-size:12px;padding:2px 0;">${frappe.utils.escape_html(
						file,
					)}</div>`,
			)
			.join('');
		dialog.fields_dict.backup_directory_preview.$wrapper.html(
			`<div style="border:1px solid #e9ecef;border-radius:6px;padding:8px 10px;background:#fff;">
				<div style="font-size:12px;font-weight:600;margin-bottom:6px;">${frappe.utils.escape_html(
					backup.label || backup.directory,
				)}</div>
				<div style="font-size:11px;color:#6c757d;margin-bottom:6px;"><code>${frappe.utils.escape_html(
					backup.directory,
				)}</code></div>
				${
					files ||
					`<div class="text-muted" style="font-size:12px;">${__(
						'No files found in this directory.',
					)}</div>`
				}
			</div>`,
		);
	}

	dialog.show();
	dialog.fields_dict.restore_mode.$input.on('change', updateModeUI);
	dialog.fields_dict.backup_directory.$input.on(
		'change',
		updateBackupDirectoryPreview,
	);
	updateModeUI();
}

function open_manage_backups_dialog(frm, initialCatalog) {
	const dialog = new frappe.ui.Dialog({
		title: __('Manage Site Backups'),
		fields: [
			{
				fieldname: 'catalog_html',
				fieldtype: 'HTML',
			},
		],
		primary_action_label: __('Refresh'),
		primary_action() {
			refresh_catalog();
		},
	});

	const wrapper = dialog.fields_dict.catalog_html.$wrapper;
	let catalog = initialCatalog || { backups: [], root_directory: '' };

	const render_catalog = () => {
		const backups = catalog?.backups || [];
		const root = catalog?.root_directory || '';

		if (!backups.length) {
			wrapper.html(
				`<div class="text-muted" style="font-size:12px;">
					${__('No backups found for this site.')}
					${
						root
							? `<br>${__('Root directory')}: <code>${frappe.utils.escape_html(root)}</code>`
							: ''
					}
				</div>`,
			);
			return;
		}

		const cards = backups
			.map((backup) => {
				const dir = backup.directory || '';
				const label = backup.label || dir;
				const files = backup.files || [];
				const files_html = files.length
					? files
							.map(
								(file) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid #f1f3f5;">
									<div style="font-size:12px;word-break:break-all;">${frappe.utils.escape_html(file)}</div>
									<button class="btn btn-xs btn-default" data-action="download" data-directory="${frappe.utils.escape_html(
										dir,
									)}" data-file="${frappe.utils.escape_html(file)}">${__('Download')}</button>
								</div>`,
							)
							.join('')
					: `<div class="text-muted" style="font-size:12px;">${__('No files found in this backup directory.')}</div>`;

				return `<div style="border:1px solid #e9ecef;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#fff;">
					<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
						<div>
							<div style="font-size:13px;font-weight:600;">${frappe.utils.escape_html(label)}</div>
							<div style="font-size:11px;color:#6c757d;"><code>${frappe.utils.escape_html(dir)}</code></div>
						</div>
						<button class="btn btn-xs btn-danger" data-action="delete-directory" data-directory="${frappe.utils.escape_html(
							dir,
						)}">${__('Delete')}</button>
					</div>
					<div style="margin-top:8px;">${files_html}</div>
				</div>`;
			})
			.join('');

		wrapper.html(
			`<div style="font-size:12px;color:#6c757d;margin-bottom:8px;">${__('Root directory')}: <code>${frappe.utils.escape_html(
				root,
			)}</code></div>${cards}`,
		);

		wrapper.find('[data-action="download"]').on('click', function () {
			const $btn = $(this);
			const backup_directory = $btn.attr('data-directory') || '';
			const file_name = $btn.attr('data-file') || '';
			if (!backup_directory || !file_name) return;

			$btn.prop('disabled', true).text(__('Downloading...'));
			frm
				.call('download_site_backup_file', {
					backup_directory,
					file_name,
				})
				.then((r) => {
					const file_url = r?.message?.file?.file_url;
					if (file_url) {
						window.open(encodeURI(file_url), '_blank');
					}
					frappe.show_alert({
						message:
							r?.message?.message || __('Backup file downloaded successfully.'),
						indicator: 'green',
					});
				})
				.catch((err) => {
					frappe.msgprint(
						err?.message || __('Failed to download backup file.'),
					);
				})
				.finally(() => {
					$btn.prop('disabled', false).text(__('Download'));
				});
		});

		wrapper.find('[data-action="delete-directory"]').on('click', function () {
			const backup_directory = $(this).attr('data-directory') || '';
			if (!backup_directory) return;

			frappe.confirm(
				__('Delete this backup directory and all files inside it? This cannot be undone.'),
				() => {
					frm
						.call('delete_site_backup_directory', { backup_directory })
						.then((r) => {
							frappe.show_alert({
								message:
									r?.message?.message || __('Backup directory deleted.'),
								indicator: 'green',
							});
							refresh_catalog();
						})
						.catch((err) => {
							frappe.msgprint(
								err?.message || __('Failed to delete backup directory.'),
							);
						});
				},
			);
		});
	};

	const refresh_catalog = () => {
		wrapper.html(
			`<div class="text-muted" style="font-size:12px;">${__('Loading backups...')}</div>`,
		);
		frm
			.call('list_site_backups')
			.then((r) => {
				catalog = r?.message || { backups: [], root_directory: '' };
				render_catalog();
			})
			.catch((err) => {
				wrapper.html(
					`<div class="text-danger" style="font-size:12px;">${frappe.utils.escape_html(
						err?.message || __('Failed to load backups.'),
					)}</div>`,
				);
			});
	};

	dialog.show();
	render_catalog();
}

function start_manage_backups(frm) {
	frappe.show_alert(
		{ message: __('Loading backups for management...'), indicator: 'blue' },
		3,
	);
	frm
		.call('list_site_backups')
		.then((r) => open_manage_backups_dialog(frm, r?.message || {}))
		.catch((err) => {
			frappe.msgprint(err?.message || __('Failed to load available backups.'));
		});
}

function start_stop_site(frm) {
	frappe.confirm(__('Stop all running containers for this site?'), () => {
		const EXPECTED_CORE_CONTAINERS = 9;
		const d = open_progress_dialog(
			__('Stopping Containers'),
			frm,
			frm.doc.name,
			'Frappe Site',
			['Stopping containers'],
			{
				success_message: __('Containers stopped successfully.'),
				poll_interval: 4000,
				poll_status: async () => {
					try {
						const [value_response, runtime_response] = await Promise.all([
							frappe.call({
								method: 'frappe.client.get_value',
								args: {
									doctype: 'Frappe Site',
									filters: { name: frm.doc.name },
									fieldname: ['status'],
								},
							}),
							frappe.call({
								method:
									'nano_press.nano_press.doctype.frappe_site.frappe_site.get_runtime_progress',
								args: { site_name: frm.doc.name },
							}),
						]);

						const status = value_response?.message?.status;
						const runtime = runtime_response?.message?.runtime || {};
						const running_count = Math.max(
							0,
							Math.min(
								EXPECTED_CORE_CONTAINERS,
								cint(runtime.containers_running || 0),
							),
						);

						if (status === 'Failed') {
							return {
								status: 'failed',
								step: 'Failed',
								percent: 0,
								message: __('Stop containers failed.'),
							};
						}

						if (running_count === 0 && status === 'Stopped') {
							return {
								status: 'success',
								step: 'Complete',
								percent: 100,
								message: __('Containers stopped successfully.'),
							};
						}

						const percent = Math.max(
							10,
							Math.min(
								95,
								Math.round(
									((EXPECTED_CORE_CONTAINERS - running_count) /
										EXPECTED_CORE_CONTAINERS) *
										95,
								),
							),
						);
						return {
							status: 'running',
							step: 'Stopping containers',
							percent,
							message:
								running_count === 0
									? __('Containers are stopped. Finalizing state...')
									: __('Stopping containers: {0}/{1} still running', [running_count, EXPECTED_CORE_CONTAINERS]),
						};
					} catch (e) {
						return null;
					}
				},
			},
		);
		d.onhide = () => frm.reload_doc();
		frm
			.call('stop_site')
			.then((r) => {
				if (r?.message?.status === 'queued' && r?.message?.queued_at) {
					d.set_queued_at(r.message.queued_at);
				}
				if (r?.message?.status !== 'queued') {
					d.mark_failed(
						r?.message?.message || __('Failed to stop containers.'),
					);
				}
			})
			.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
	});
}

function start_restart_site(frm) {
	const EXPECTED_CORE_CONTAINERS = 9;
	const d = open_progress_dialog(
		__('Restarting Containers'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Restarting containers'],
		{
			success_message: __('Containers restarted successfully.'),
			poll_interval: 4000,
			poll_status: async ({ queued_at }) => {
				try {
					const [value_response, runtime_response] = await Promise.all([
						frappe.call({
							method: 'frappe.client.get_value',
							args: {
								doctype: 'Frappe Site',
								filters: { name: frm.doc.name },
								fieldname: ['status', 'last_deployed_at'],
							},
						}),
						frappe.call({
							method:
								'nano_press.nano_press.doctype.frappe_site.frappe_site.get_runtime_progress',
							args: { site_name: frm.doc.name },
						}),
					]);

					const value = value_response?.message || {};
					const status = value.status;
					const queued_at_ms = queued_at ? Date.parse(queued_at) : NaN;
					const restarted_at_ms = value.last_deployed_at
						? Date.parse(value.last_deployed_at)
						: NaN;
					const runtime = runtime_response?.message?.runtime || {};
					const running_count = Math.max(
						0,
						Math.min(
							EXPECTED_CORE_CONTAINERS,
							cint(runtime.containers_running || 0),
						),
					);

					if (status === 'Failed') {
						return {
							status: 'failed',
							step: 'Failed',
							percent: 0,
							message: __('Restart containers failed.'),
						};
					}

					const restarted_in_this_run =
						status === 'Deployed' &&
						running_count >= EXPECTED_CORE_CONTAINERS &&
						(!Number.isFinite(queued_at_ms) ||
							(Number.isFinite(restarted_at_ms) && restarted_at_ms >= queued_at_ms));

					if (restarted_in_this_run) {
						return {
							status: 'success',
							step: 'Complete',
							percent: 100,
							message: __('Containers restarted successfully.'),
						};
					}

					if (running_count > 0) {
						const percent = Math.max(10, Math.min(95, running_count * 10));
						return {
							status: 'running',
							step: 'Restarting containers',
							percent,
							message: __('Running core containers: {0}/{1}', [running_count, EXPECTED_CORE_CONTAINERS]),
						};
					}

					return {
						status: 'running',
						step: 'Restarting containers',
						percent: 10,
						message: __('Worker is restarting containers...'),
					};
				} catch (e) {
					return null;
				}
			},
		},
	);
	d.onhide = () => frm.reload_doc();
	frm
		.call('restart_site')
		.then((r) => {
			if (r?.message?.status === 'queued' && r?.message?.queued_at) {
				d.set_queued_at(r.message.queued_at);
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(
					r?.message?.message || __('Failed to restart containers.'),
				);
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_remove_site(frm) {
	const EXPECTED_CORE_CONTAINERS = 9;
	const d = open_progress_dialog(
		__('Destroying Site'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Destroying site'],
		{
			success_message: __('Site destroyed successfully.'),
			poll_interval: 4000,
			poll_status: async () => {
				try {
					const [value_response, runtime_response] = await Promise.all([
						frappe.call({
							method: 'frappe.client.get_value',
							args: {
								doctype: 'Frappe Site',
								filters: { name: frm.doc.name },
								fieldname: ['status'],
							},
						}),
						frappe.call({
							method:
								'nano_press.nano_press.doctype.frappe_site.frappe_site.get_runtime_progress',
							args: { site_name: frm.doc.name },
						}),
					]);

					const status = value_response?.message?.status;
					const runtime = runtime_response?.message?.runtime || {};
					const running_count = Math.max(
						0,
						Math.min(
							EXPECTED_CORE_CONTAINERS,
							cint(runtime.containers_running || 0),
						),
					);

					if (status === 'Failed') {
						return {
							status: 'failed',
							step: 'Failed',
							percent: 0,
							message: __('Destroy site failed.'),
						};
					}

					if (running_count === 0 && status === 'Not Deployed') {
						return {
							status: 'success',
							step: 'Complete',
							percent: 100,
							message: __('Site destroyed successfully.'),
						};
					}

					if (running_count === 0) {
						return {
							status: 'running',
							step: 'Destroying site',
							percent: 95,
							message: __('Containers are gone. Finalizing cleanup...'),
						};
					}

					const percent = Math.max(
						10,
						Math.min(
							95,
							Math.round(((EXPECTED_CORE_CONTAINERS - running_count) / EXPECTED_CORE_CONTAINERS) * 95),
						),
					);
					return {
						status: 'running',
						step: 'Destroying site',
						percent,
						message: __('Removing site containers: {0}/{1} still running', [running_count, EXPECTED_CORE_CONTAINERS]),
					};
				} catch (e) {
					return null;
				}
			},
		},
	);
	d.onhide = () => frm.reload_doc();
	frm
		.call('remove_site')
		.then((r) => {
			if (r?.message?.status === 'queued' && r?.message?.queued_at) {
				d.set_queued_at(r.message.queued_at);
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(r?.message?.message || __('Failed to destroy site.'));
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_backup_site(frm) {
	let backup_run_id = null;
	const d = open_progress_dialog(
		__('Creating Site Backup'),
		frm,
		frm.doc.name,
		'Frappe Site',
		[
			__('Preparing backup operation'),
			__('Starting backup command'),
			__('Running backup command'),
			__('Collecting backup files'),
			__('Preparing backup downloads'),
		],
		{
			success_message: __('Site backup completed successfully.'),
			poll_interval: 4000,
			poll_status: async () => {
				try {
					if (!backup_run_id) return null;
					const progress_response = await frappe.call({
						method:
							'nano_press.nano_press.doctype.frappe_site.frappe_site.get_site_action_progress',
						args: {
							site_name: frm.doc.name,
							action: 'backup',
							run_id: backup_run_id,
						},
					});
					return progress_response?.message || null;
				} catch (e) {
					console.error('Backup polling error:', e);
					return null;
				}
			},
			on_success: (data) => show_backup_ready_dialog(data),
		},
	);
	d.onhide = () => frm.reload_doc();
	frm
		.call('create_site_backup')
		.then((r) => {
			if (r?.message?.status === 'queued' && r?.message?.run_id) {
				backup_run_id = r.message.run_id;
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(
					r?.message?.message || __('Failed to start site backup.'),
				);
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_restore_site(frm) {
	frappe.show_alert(
		{ message: __('Loading available backups...'), indicator: 'blue' },
		3,
	);
	frm
		.call('list_site_backups')
		.then((r) => open_restore_site_dialog(frm, r?.message || {}))
		.catch((err) => {
			frappe.msgprint(err?.message || __('Failed to load available backups.'));
		});
}

function start_suspend_site(frm) {
	frappe.confirm(__('Suspend this site by enabling maintenance mode?'), () => {
		frm
			.call('suspend_site')
			.then((r) => {
				const msg = r?.message || {};
				if (msg.status !== 'success') {
					frappe.msgprint(msg.message || __('Failed to suspend site.'));
					return;
				}
				frappe.show_alert(
					{
						message: __(msg.message || 'Site suspended.'),
						indicator: 'orange',
					},
					5,
				);
				frm.reload_doc();
			})
			.catch((err) =>
				frappe.msgprint(err?.message || __('Failed to suspend site.')),
			);
	});
}

function start_unsuspend_site(frm) {
	frm
		.call('unsuspend_site')
		.then((r) => {
			const msg = r?.message || {};
			if (msg.status !== 'success') {
				frappe.msgprint(msg.message || __('Failed to unsuspend site.'));
				return;
			}
			frappe.show_alert(
				{ message: __(msg.message || 'Site unsuspended.'), indicator: 'green' },
				5,
			);
			frm.reload_doc();
		})
		.catch((err) =>
			frappe.msgprint(err?.message || __('Failed to unsuspend site.')),
		);
}

function start_reset_admin_password(frm) {
	frappe.prompt(
		[
			{
				fieldname: 'new_password',
				label: __('New Password (optional)'),
				fieldtype: 'Password',
				description: __('Leave blank to generate a strong random password.'),
				reqd: 0,
			},
		],
		(values) => {
			frm
				.call('reset_admin_password', {
					new_password: values.new_password || '',
				})
				.then((r) => {
					const msg = r?.message || {};
					if (msg.status !== 'success') {
						frappe.msgprint(
							msg.message || __('Failed to reset admin password.'),
						);
						return;
					}

					const newPassword = msg.password || '';
					frm.reload_doc();

					frappe.msgprint({
						title: __('Admin Password Reset'),
						indicator: 'green',
						message: `
							<p>${__('Administrator password reset successfully.')}</p>
							<p><b>${__('Username')}:</b> ${
								frm.doc.username || 'Administrator'
							}</p>
							<p><b>${__('Password')}:</b></p>
							<pre style="white-space: pre-wrap; word-break: break-all;">${frappe.utils.escape_html(
								newPassword,
							)}</pre>
						`,
						primary_action: {
							label: __('Copy Password'),
							action() {
								navigator.clipboard
									.writeText(newPassword)
									.then(() =>
										frappe.show_alert(__('Password copied to clipboard!')),
									)
									.catch(() =>
										frappe.show_alert(__('Unable to copy password.')),
									);
							},
						},
					});
				})
				.catch((err) => {
					frappe.msgprint(
						err?.message || __('Failed to reset admin password.'),
					);
				});
		},
		__('Reset Admin Password'),
		__('Reset'),
	);
}

function start_install_app(frm) {
	// For custom-image sites, fetch only the apps available in the image
	// that are not yet installed. For standard sites, fall back to a free Link.
	const is_custom = frm.doc.is_custom && frm.doc.custom_image;

	const open_install_dialog = (fields) => {
		frappe.prompt(
			fields,
			(values) => {
				const app_name = values.app_name;
				if (!app_name) return;
				let app_run_id = null;

				const d = open_progress_dialog(
					__('Installing App'),
					frm,
					frm.doc.name,
					'Frappe Site',
					[
						'Preparing app operation',
						'Starting app command',
						'Running app command',
					],
					{
						success_message: __('App installed successfully.'),
						poll_interval: 4000,
						poll_status: async () => {
							try {
								if (!app_run_id) return null;
								const progress_response = await frappe.call({
									method:
										'nano_press.nano_press.doctype.frappe_site.frappe_site.get_site_action_progress',
									args: {
										site_name: frm.doc.name,
										action: 'install',
										run_id: app_run_id,
									},
								});
								return progress_response?.message || null;
							} catch (e) {
								return null;
							}
						},
					},
				);
				d.onhide = () => frm.reload_doc();

				frm
					.call('install_site_app', { app_name })
					.then((r) => {
						if (r?.message?.status === 'queued' && r?.message?.run_id) {
							app_run_id = r.message.run_id;
						}
						if (r?.message?.status === 'queued' && r?.message?.queued_at) {
							d.set_queued_at(r.message.queued_at);
						}
						if (r?.message?.status !== 'queued') {
							d.mark_failed(
								r?.message?.message || __('Failed to start app installation.'),
							);
						}
					})
					.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
			},
			__('Install App'),
			__('Start'),
		);
	};

	if (is_custom) {
		frm.call('get_image_available_apps').then((r) => {
			const apps = r?.message || [];
			if (!apps.length) {
				frappe.msgprint(
					__('All apps in the custom image are already installed on this site.'),
				);
				return;
			}
			const options = apps.map((a) => ({ label: a.label, value: a.app_name }));
			open_install_dialog([
				{
					fieldname: 'app_name',
					label: __('App'),
					fieldtype: 'Select',
					options: options.map((o) => o.value),
					reqd: 1,
					description: __(
						'Only apps available in the custom image and not yet installed are shown.',
					),
				},
			]);
		});
	} else {
		open_install_dialog([
			{
				fieldname: 'app_name',
				label: __('App'),
				fieldtype: 'Link',
				options: 'Apps',
				reqd: 1,
			},
		]);
	}
}

function start_uninstall_app(frm) {
	frm.call('get_installed_apps').then((r) => {
		const installed_apps = r?.message || [];
		if (!installed_apps.length) {
			frappe.msgprint(__('No apps found installed on this site.'));
			return;
		}

		frappe.prompt(
			[
				{
					fieldname: 'app_name',
					label: __('App'),
					fieldtype: 'Select',
					options: installed_apps.join('\n'),
					reqd: 1,
				},
			],
		(values) => {
			frappe.confirm(
				__('Are you sure you want to uninstall app {0} from this site?', [
					values.app_name,
				]),
				() => {
					let app_run_id = null;
					const d = open_progress_dialog(
						__('Uninstalling App'),
						frm,
						frm.doc.name,
						'Frappe Site',
						[
							'Preparing app operation',
							'Starting app command',
							'Running app command',
						],
						{
							success_message: __('App uninstalled successfully.'),
							poll_interval: 4000,
							poll_status: async () => {
								try {
									if (!app_run_id) return null;
									const progress_response = await frappe.call({
										method:
											'nano_press.nano_press.doctype.frappe_site.frappe_site.get_site_action_progress',
										args: {
											site_name: frm.doc.name,
											action: 'uninstall',
											run_id: app_run_id,
										},
									});
									return progress_response?.message || null;
								} catch (e) {
									return null;
								}
							},
						},
					);
					d.onhide = () => frm.reload_doc();

					frm
						.call('uninstall_site_app', { app_name: values.app_name })
						.then((r) => {
							if (r?.message?.status === 'queued' && r?.message?.run_id) {
								app_run_id = r.message.run_id;
							}
							if (r?.message?.status === 'queued' && r?.message?.queued_at) {
								d.set_queued_at(r.message.queued_at);
							}
							if (r?.message?.status !== 'queued') {
								d.mark_failed(
									r?.message?.message || __('Failed to start app uninstall.'),
								);
							}
						})
						.catch((err) =>
							d.mark_failed(err?.message || __('Request failed.')),
						);
				},
			);
		},
		__('Uninstall App'),
		__('Continue'),
		);
	});
}

function sync_site_runtime(frm) {
	if (frm.__syncing_runtime) return;
	// Also sync Not Deployed in case status was wrongly reset while containers are still running
	if (
		![
			'Not Deployed',
			'Ready To Deploy',
			'Deployed',
			'Stopped',
			'Failed',
		].includes(frm.doc.status)
	)
		return;
	// Don't bother syncing a brand-new record that has never been assigned a server
	if (!frm.doc.server_name || !frm.doc.bench_name) return;

	frm.__syncing_runtime = true;
	frm
		.call('sync_runtime_status')
		.then((r) => {
			const m = r?.message || {};
			if (m.changed) {
				frm.reload_doc();
			}
		})
		.finally(() => {
			frm.__syncing_runtime = false;
		});
}

function start_check_status(frm) {
	if (!frm.doc.name) return;
	frappe.show_alert(
		{ message: __('Checking site status…'), indicator: 'blue' },
		4,
	);
	frm
		.call('sync_runtime_status')
		.then((r) => {
			const m = r?.message || {};
			if (m.changed) {
				frappe.show_alert(
					{
						message: __('Status updated to: {0}', [m.status]),
						indicator: 'green',
					},
					5,
				);
				frm.reload_doc();
			} else {
				frappe.show_alert(
					{
						message: __('Status unchanged: {0}', [m.status || frm.doc.status]),
						indicator: 'orange',
					},
					5,
				);
			}
		})
		.catch(() => {
			frappe.show_alert(
				{
					message: __('Could not reach server to check status.'),
					indicator: 'red',
				},
				5,
			);
		});
}

function call_doc_method(frm, method_name) {
	if (!frm.doc.name) {
		frappe.msgprint(__('Please save the document before calling this action.'));
		return;
	}

	const actionLabels = {
		prepare_for_deployment: __('Prepare for Deployment'),
		deploy_site: __('Deploy Site'),
		stop_site: __('Stop Containers'),
		remove_site: __('Remove Site'),
	};
	const actionLabel = actionLabels[method_name] || method_name;
	frappe.show_alert(
		{ message: __('Processing: {0}', [actionLabel]), indicator: 'blue' },
		3,
	);

	frm
		.call(method_name)
		.then((r) => {
			const msg = r?.message || {};
			const display =
				typeof msg === 'string'
					? msg
					: msg.job_id || msg.message || JSON.stringify(msg);
			frappe.show_alert(
				{ message: __('Result: {0}', [display]), indicator: 'green' },
				6,
			);
			frm.reload_doc();
		})
		.catch((err) => {
			console.error(err);
			frappe.msgprint(err?.message || __('Server call failed'));
		});
}
