frappe.ui.form.on('Frappe Site', {
	setup(frm) {
		set_custom_image_query(frm);
	},

	refresh(frm) {
		set_custom_image_query(frm);
		frm.set_df_property('admin_password', 'hidden', 0);
		frm.set_df_property('admin_password', 'read_only', 0);

		if (!frm.is_new()) {
			sync_site_runtime(frm);
		}

		if (frm.doc.status === 'Not Deployed') {
			frm
				.add_custom_button(__('Prepare for Deployment'), () =>
					start_prepare_deployment(frm),
				)
				.addClass('btn-default');
			frm.set_intro(__('Not deployed yet. Prepare deployment first, then deploy.'), 'blue');
		} else if (frm.doc.status === 'Ready To Deploy') {
			frm
				.add_custom_button(__('Deploy Site'), () =>
					start_deploy_site(frm, { force_redeploy: 0 }),
				)
				.addClass('btn-primary');
		} else if (frm.doc.status === 'Deployed') {
			frm.add_custom_button(__('Stop Containers'), () => start_stop_site(frm), __('Actions'));
			frm.add_custom_button(__('Restart Containers'), () => start_restart_site(frm), __('Actions'));
			frm.add_custom_button(__('Backup Site'), () => start_backup_site(frm), __('Actions'));
			frm.add_custom_button(__('Restore Site'), () => start_restore_site(frm), __('Actions'));
			frm.add_custom_button(__('Reset Admin Password'), () => start_reset_admin_password(frm), __('Actions'));
			frm.add_custom_button(__('Install App'), () => start_install_app(frm), __('Actions'));
			frm.add_custom_button(__('Uninstall App'), () => start_uninstall_app(frm), __('Actions'));
			frm.add_custom_button(__('Redeploy Site'), () => {
				frappe.confirm(
					__('Are you sure you want to redeploy the site?'),
					() => start_deploy_site(frm, { force_redeploy: 1 }),
				);
			}, __('Actions'));
			frm.add_custom_button(__('Destroy Site'), () => {
				frappe.confirm(
					__('Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.'),
					() => start_remove_site(frm),
				);
			}, __('Actions'));
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
		} else if (frm.doc.status === 'Stopped') {
			frm
				.add_custom_button(__('Start Containers'), () =>
					start_restart_site(frm),
				)
				.addClass('btn-primary');
			frm.add_custom_button(__('Deploy Site'), () =>
				start_deploy_site(frm, { force_redeploy: 0 }),
			__('Actions'));
			frm.add_custom_button(__('Destroy Site'), () => {
				frappe.confirm(
					__('Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.'),
					() => start_remove_site(frm),
				);
			}, __('Actions'));
		} else if (!frm.doc.ssl_enabled && frm.doc.server_name) {
			frappe.db.get_doc('Server', frm.doc.server_name).then((server) => {
				const ip = server.server_ip || 'localhost';
				frm
					.add_custom_button(__('Visit Site (Insecure)'), () =>
						window.open(`http://${ip}:8080`),
					)
					.addClass('btn-warning');
			});
		} else if (frm.doc.status === 'Failed') {
			frm
				.add_custom_button(__('Check Status'), () => start_check_status(frm))
				.addClass('btn-primary');
			frm.add_custom_button(__('Retry Deployment'), () =>
				start_prepare_deployment(frm),
			__('Actions'));
			frm.add_custom_button(__('Restart Containers'), () => start_restart_site(frm), __('Actions'));
			frm.add_custom_button(__('Stop Containers'), () => start_stop_site(frm), __('Actions'));
			frm.add_custom_button(__('Redeploy Site'), () => {
				frappe.confirm(
					__('Are you sure you want to redeploy the site?'),
					() => start_deploy_site(frm, { force_redeploy: 1 }),
				);
			}, __('Actions'));
			frm.add_custom_button(__('Destroy Site'), () => {
				frappe.confirm(
					__('Are you sure you want to destroy this site? This will remove containers and volumes and cannot be undone.'),
					() => start_remove_site(frm),
				);
			}, __('Actions'));
			frm.set_intro(__('Last action failed. Click Check Status to detect the current state of the site and restore the correct actions.'), 'red');
		}

		// (Re)bind clipboard handlers safely on every refresh
		bind_clipboard_handlers(frm);
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

function clear_mismatched_custom_image(frm) {
	if (!frm.doc.is_custom || !frm.doc.custom_image || !frm.doc.server_name) {
		return;
	}

	frappe.db
		.get_value('Custom Image', frm.doc.custom_image, ['server_name', 'build_status'])
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
						"Custom image is built on server {0}, but this site uses server {1}. Please select a custom image built on the same server.",
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
		{ success_message: __('Deployment preparation complete!') },
	);
	d.onhide = () => frm.reload_doc();

	frm.call('prepare_for_deployment')
		.then((r) => {
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
		['Deploying containers', 'Installing apps'],
		{ success_message: force_redeploy ? __('Site redeployed successfully.') : __('Site deployed successfully.') },
	);
	d.onhide = () => frm.reload_doc();

	frm.call('deploy_site', { force_redeploy })
		.then((r) => {
			if (r?.message?.status === 'already_running') {
				d.mark_info(
					__('Site is already running. Use Redeploy Site if you want to recreate containers.'),
				);
				frm.reload_doc();
				return;
			}
			if (r?.message?.status !== 'queued') {
				d.mark_failed(r?.message?.message || __('Failed to start site deployment.'));
			}
		})
		.catch((err) => {
			d.mark_failed(err?.message || __('Request failed.'));
		});
}

function open_progress_dialog(title, frm, doc_name, doc_type, step_labels, opts = {}) {
	let completed = new Set();
	let current_step = step_labels[0];
	let active = true;
	let live_tasks = [];
	let success_handled = false;

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
			frm.reload_doc();
			setTimeout(() => d.get_close_btn().show(), 500);
			frappe.show_alert(
				{ message: opts.success_message || __('Operation completed!'), indicator: 'green' },
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
			frappe.show_alert({ message: opts.failed_message || __('Operation failed!'), indicator: 'red' }, 5);
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

	const _original_onhide = d.onhide;
	const cleanup = () => {
		active = false;
		frappe.realtime.off('nano_press:progress', on_event);
		if (_original_onhide) _original_onhide();
	};
	d.onhide = cleanup;

	d.mark_failed = (msg) => {
		on_event({ doc_name, doc_type, step: 'Failed', percent: 0, status: 'failed', message: msg });
	};

	d.mark_info = (msg) => {
		update_ui({ percent: 100, status: 'info', message: msg });
		d.get_close_btn().show();
	};

	return d;
}

function show_backup_ready_dialog(data) {
	const files = data?.backup_files || [];
	const remoteDir = data?.backup_directory || '';
	const escapedDir = remoteDir ? frappe.utils.escape_html(remoteDir) : '';
	const links = files.length
		? files
				.map((file) => {
					const label = frappe.utils.escape_html(file.label || file.file_name || __('Backup File'));
					const name = frappe.utils.escape_html(file.file_name || '');
					const href = encodeURI(file.file_url || '#');
					return `<div style="padding:8px 0;border-top:1px solid #f1f3f5;">
						<div style="font-size:12px;font-weight:600;">${label}</div>
						<div style="font-size:12px;color:#6c757d;">${name}</div>
						<div style="margin-top:4px;"><a href="${href}" target="_blank">${__('Download')}</a></div>
					</div>`;
				})
				.join('')
		: `<div class="text-muted" style="font-size:12px;">${__('No downloadable files were registered for this backup.')}</div>`;

	frappe.msgprint({
		title: __('Backup Ready'),
		wide: true,
		message: `
			<div>
				${
					escapedDir
						? `<div style="font-size:12px;margin-bottom:10px;">${__('Saved on server at')}:<br><code>${escapedDir}</code></div>`
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
	const defaultMode = backupOptions.length ? 'server_directory' : 'uploaded_files';

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
				frappe.msgprint(__('Choose a backup directory from the server backups list.'));
				return;
			}

			if (
				restoreMode === 'uploaded_files'
				&& (!values.db_file_url || !values.public_file_url || !values.private_file_url)
			) {
				frappe.msgprint(__('Upload database, public files and private files backups before restoring.'));
				return;
			}

			frappe.confirm(
				__('Restore will overwrite current site data. Are you sure you want to continue?'),
				() => {
					dialog.hide();
					const stepLabels =
						restoreMode === 'uploaded_files'
							? [
								__('Preparing backup operation'),
								__('Preparing restore files'),
								__('Starting backup command'),
								__('Running backup command'),
							]
							: [
								__('Preparing backup operation'),
								__('Validating restore files'),
								__('Starting backup command'),
								__('Running backup command'),
							];

					const progress = open_progress_dialog(
						__('Restoring Site Backup'),
						frm,
						frm.doc.name,
						'Frappe Site',
						stepLabels,
						{ success_message: __('Site restore completed successfully.') },
					);
					progress.onhide = () => frm.reload_doc();

					frm.call('restore_site_backup', {
						restore_mode: restoreMode,
						backup_directory: values.backup_directory || '',
						db_file_url: values.db_file_url || '',
						public_file_url: values.public_file_url || '',
						private_file_url: values.private_file_url || '',
					})
						.then((r) => {
							if (r?.message?.status !== 'queued') {
								progress.mark_failed(r?.message?.message || __('Failed to start site restore.'));
							}
						})
						.catch((err) => progress.mark_failed(err?.message || __('Request failed.')));
				},
			);
		},
	});

	function updateModeUI() {
		const restoreMode = dialog.get_value('restore_mode') || defaultMode;
		const useServerDirectory = restoreMode === 'server_directory';

		dialog.set_df_property('backup_directory', 'hidden', !useServerDirectory);
		dialog.set_df_property('backup_directory_preview', 'hidden', !useServerDirectory);
		dialog.set_df_property('server_backup_help', 'hidden', !useServerDirectory);
		dialog.set_df_property('db_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('public_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('private_file_url', 'hidden', useServerDirectory);
		dialog.set_df_property('upload_help', 'hidden', useServerDirectory);
		dialog.set_df_property('backup_directory', 'reqd', useServerDirectory ? 1 : 0);
		dialog.set_df_property('db_file_url', 'reqd', useServerDirectory ? 0 : 1);
		dialog.set_df_property('public_file_url', 'reqd', useServerDirectory ? 0 : 1);
		dialog.set_df_property('private_file_url', 'reqd', useServerDirectory ? 0 : 1);

		dialog.fields_dict.server_backup_help.$wrapper.html(
			useServerDirectory
				? `<div class="text-muted" style="font-size:12px;margin-bottom:10px;">${__('Choose a timestamped backup directory from the target server.')}${
					rootDirectory
						? `<br>${__('Root directory')}: <code>${frappe.utils.escape_html(rootDirectory)}</code>`
						: ''
				}</div>`
				: '',
		);

		dialog.fields_dict.upload_help.$wrapper.html(
			!useServerDirectory
				? `<div class="text-muted" style="font-size:12px;margin-bottom:10px;">${__('Upload the three backup artifacts to restore this site.')}</div>`
				: '',
		);

		updateBackupDirectoryPreview();
	}

	function updateBackupDirectoryPreview() {
		const selected = dialog.get_value('backup_directory') || '';
		const backup = backupMap.get(selected);
		if (!backup) {
			dialog.fields_dict.backup_directory_preview.$wrapper.html(
				`<div class="text-muted" style="font-size:12px;">${__('No backup directory selected.')}</div>`,
			);
			return;
		}

		const files = (backup.files || [])
			.map((file) => `<div style="font-size:12px;padding:2px 0;">${frappe.utils.escape_html(file)}</div>`)
			.join('');
		dialog.fields_dict.backup_directory_preview.$wrapper.html(
			`<div style="border:1px solid #e9ecef;border-radius:6px;padding:8px 10px;background:#fff;">
				<div style="font-size:12px;font-weight:600;margin-bottom:6px;">${frappe.utils.escape_html(backup.label || backup.directory)}</div>
				<div style="font-size:11px;color:#6c757d;margin-bottom:6px;"><code>${frappe.utils.escape_html(backup.directory)}</code></div>
				${files || `<div class="text-muted" style="font-size:12px;">${__('No files found in this directory.')}</div>`}
			</div>`,
		);
	}

	dialog.show();
	dialog.fields_dict.restore_mode.$input.on('change', updateModeUI);
	dialog.fields_dict.backup_directory.$input.on('change', updateBackupDirectoryPreview);
	updateModeUI();
}

function start_stop_site(frm) {
	frappe.confirm(__('Stop all running containers for this site?'), () => {
		const d = open_progress_dialog(
			__('Stopping Containers'),
			frm,
			frm.doc.name,
			'Frappe Site',
			['Stopping containers'],
			{ success_message: __('Containers stopped successfully.') },
		);
		d.onhide = () => frm.reload_doc();
		frm.call('stop_site')
			.then((r) => {
				if (r?.message?.status !== 'queued') {
					d.mark_failed(r?.message?.message || __('Failed to stop containers.'));
				}
			})
			.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
	});
}

function start_restart_site(frm) {
	const d = open_progress_dialog(
		__('Restarting Containers'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Restarting containers'],
		{ success_message: __('Containers restarted successfully.') },
	);
	d.onhide = () => frm.reload_doc();
	frm.call('restart_site')
		.then((r) => {
			if (r?.message?.status !== 'queued') {
				d.mark_failed(r?.message?.message || __('Failed to restart containers.'));
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_remove_site(frm) {
	const d = open_progress_dialog(
		__('Destroying Site'),
		frm,
		frm.doc.name,
		'Frappe Site',
		['Destroying site'],
		{ success_message: __('Site destroyed successfully.') },
	);
	d.onhide = () => frm.reload_doc();
	frm.call('remove_site')
		.then((r) => {
			if (r?.message?.status !== 'queued') {
				d.mark_failed(r?.message?.message || __('Failed to destroy site.'));
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_backup_site(frm) {
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
			on_success: (data) => show_backup_ready_dialog(data),
		},
	);
	d.onhide = () => frm.reload_doc();
	frm.call('create_site_backup')
		.then((r) => {
			if (r?.message?.status !== 'queued') {
				d.mark_failed(r?.message?.message || __('Failed to start site backup.'));
			}
		})
		.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
}

function start_restore_site(frm) {
	frappe.show_alert({ message: __('Loading available backups...'), indicator: 'blue' }, 3);
	frm.call('list_site_backups')
		.then((r) => open_restore_site_dialog(frm, r?.message || {}))
		.catch((err) => {
			frappe.msgprint(err?.message || __('Failed to load available backups.'));
		});
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
			frm.call('reset_admin_password', {
				new_password: values.new_password || '',
			})
				.then((r) => {
					const msg = r?.message || {};
					if (msg.status !== 'success') {
						frappe.msgprint(msg.message || __('Failed to reset admin password.'));
						return;
					}

					const newPassword = msg.password || '';
					frm.reload_doc();

					frappe.msgprint({
						title: __('Admin Password Reset'),
						indicator: 'green',
						message: `
							<p>${__('Administrator password reset successfully.')}</p>
							<p><b>${__('Username')}:</b> ${frm.doc.username || 'Administrator'}</p>
							<p><b>${__('Password')}:</b></p>
							<pre style="white-space: pre-wrap; word-break: break-all;">${frappe.utils.escape_html(newPassword)}</pre>
						`,
						primary_action: {
							label: __('Copy Password'),
							action() {
								navigator.clipboard
									.writeText(newPassword)
									.then(() => frappe.show_alert(__('Password copied to clipboard!')))
									.catch(() => frappe.show_alert(__('Unable to copy password.')));
							},
						},
					});
				})
				.catch((err) => {
					frappe.msgprint(err?.message || __('Failed to reset admin password.'));
				});
		},
		__('Reset Admin Password'),
		__('Reset'),
	);
}

function start_install_app(frm) {
	frappe.prompt(
		[
			{
				fieldname: 'app_name',
				label: __('App'),
				fieldtype: 'Link',
				options: 'Apps',
				reqd: 1,
			},
		],
		(values) => {
			const d = open_progress_dialog(
				__('Installing App'),
				frm,
				frm.doc.name,
				'Frappe Site',
				['Preparing app operation', 'Starting app command', 'Running app command'],
				{ success_message: __('App installed successfully.') },
			);
			d.onhide = () => frm.reload_doc();

			frm.call('install_site_app', { app_name: values.app_name })
				.then((r) => {
					if (r?.message?.status !== 'queued') {
						d.mark_failed(r?.message?.message || __('Failed to start app installation.'));
					}
				})
				.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
		},
		__('Install App'),
		__('Start'),
	);
}

function start_uninstall_app(frm) {
	frappe.prompt(
		[
			{
				fieldname: 'app_name',
				label: __('App'),
				fieldtype: 'Link',
				options: 'Apps',
				reqd: 1,
			},
		],
		(values) => {
			frappe.confirm(
				__('Are you sure you want to uninstall app {0} from this site?', [values.app_name]),
				() => {
					const d = open_progress_dialog(
						__('Uninstalling App'),
						frm,
						frm.doc.name,
						'Frappe Site',
						['Preparing app operation', 'Starting app command', 'Running app command'],
						{ success_message: __('App uninstalled successfully.') },
					);
					d.onhide = () => frm.reload_doc();

					frm.call('uninstall_site_app', { app_name: values.app_name })
						.then((r) => {
							if (r?.message?.status !== 'queued') {
								d.mark_failed(r?.message?.message || __('Failed to start app uninstall.'));
							}
						})
						.catch((err) => d.mark_failed(err?.message || __('Request failed.')));
				},
			);
		},
		__('Uninstall App'),
		__('Continue'),
	);
}

function sync_site_runtime(frm) {
	if (frm.__syncing_runtime) return;
	// Also sync Not Deployed in case status was wrongly reset while containers are still running
	if (!['Not Deployed', 'Ready To Deploy', 'Deployed', 'Stopped', 'Failed'].includes(frm.doc.status)) return;
	// Don't bother syncing a brand-new record that has never been assigned a server
	if (!frm.doc.server_name || !frm.doc.bench_name) return;

	frm.__syncing_runtime = true;
	frm.call('sync_runtime_status')
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
	frappe.show_alert({ message: __('Checking site status…'), indicator: 'blue' }, 4);
	frm.call('sync_runtime_status')
		.then((r) => {
			const m = r?.message || {};
			if (m.changed) {
				frappe.show_alert(
					{ message: __('Status updated to: {0}', [m.status]), indicator: 'green' },
					5,
				);
				frm.reload_doc();
			} else {
				frappe.show_alert(
					{ message: __('Status unchanged: {0}', [m.status || frm.doc.status]), indicator: 'orange' },
					5,
				);
			}
		})
		.catch(() => {
			frappe.show_alert({ message: __('Could not reach server to check status.'), indicator: 'red' }, 5);
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
