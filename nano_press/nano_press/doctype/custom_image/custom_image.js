// Copyright (c) 2025, Venkatesh M
// For license information, please see license.txt

frappe.ui.form.on('Custom Image', {
	refresh(frm) {
		if (frm.doc.apps_config && frm.doc.apps_config.length > 0) {
			frm.add_custom_button(
				__('Preview Apps JSON'),
				() => preview_apps_json(frm),
				__('Actions'),
			);
		}

		if (!frm.is_new() && frm.doc.build_status !== 'Building') {
			frm.add_custom_button(__('Verify'), () => verify_custom_image(frm), __('Actions'));
		}

		if (frm.doc.server_name && frm.doc.build_status !== 'Building') {
			frm.add_custom_button(
				__('Build Image'),
				() => build_custom_image(frm),
				__('Actions'),
			);
		}

		if (
			frm.doc.server_name &&
			frm.doc.build_status === 'Built' &&
			frm.doc.image_tag
		) {
			frm.add_custom_button(
				__('Remove Image From Server'),
				() => remove_custom_image(frm),
				__('Actions'),
			);
		}

		frm.add_custom_button(__('Refresh'), () => frm.reload_doc());

		if (frm.doc.build_status) {
			show_build_status_indicator(frm);
		}
	},

	apps_config(frm) {
		frm.trigger('refresh');
	},
});

function build_custom_image(frm) {
	verify_custom_image(frm, { silentSuccess: true }).then((result) => {
		if (!result?.ok) {
			return;
		}

		frappe.confirm(
			__(
				'This will build the custom Docker image on the linked server. This process may take 10–30 minutes. Continue?',
			),
			() => {
				frappe.call({
					method: 'enqueue_build_custom_image',
					doc: frm.doc,
					callback: (r) => {
						if (r.message && r.message.status === 'queued') {
							frappe.msgprint({
								title: __('Build Started'),
								message: __(
									'Image build has been queued successfully. Check the build log for progress.',
								),
								indicator: 'green',
							});
							frm.reload_doc();
						} else {
							frappe.msgprint({
								title: __('Build Failed'),
								message:
									r.message?.error ||
									__('Failed to enqueue the image build process.'),
								indicator: 'red',
							});
						}
					},
				});
			},
		);
	});
}

function verify_custom_image(frm, opts = {}) {
	return new Promise((resolve) => {
		frappe.call({
			method: 'verify_build_readiness',
			doc: frm.doc,
			args: { check_remote_repos: 1 },
			freeze: true,
			freeze_message: __('Verifying build prerequisites...'),
			callback: (r) => {
				const result = r?.message || {};
				const errors = result.errors || [];
				const warnings = result.warnings || [];
				const checks = result.checks || [];

				const esc = (v) => frappe.utils.escape_html(String(v || ''));
				const checkRows = checks
					.map(
						(c) =>
							`<tr><td style="padding:4px 12px 4px 0;">${esc(c.check)}</td><td style="padding:4px 0;">${esc(c.value)}</td><td style="padding:4px 0 4px 12px;">${c.ok ? 'OK' : 'Issue'}</td></tr>`,
					)
					.join('');

				const errorHtml = errors.length
					? `<div style="margin:8px 0;"><strong>${__('Errors')}</strong><ul style="margin:6px 0 0 18px;">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
					: '';
				const warningHtml = warnings.length
					? `<div style="margin:8px 0;"><strong>${__('Warnings')}</strong><ul style="margin:6px 0 0 18px;">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
					: '';
				const checksHtml = checkRows
					? `<div style="margin:8px 0;"><strong>${__('Checks')}</strong><table style="border-collapse:collapse;margin-top:6px;">${checkRows}</table></div>`
					: '';

				if (!result.ok || !opts.silentSuccess || warnings.length) {
					frappe.msgprint({
						title: result.ok ? __('Verification Passed') : __('Verification Failed'),
						indicator: result.ok ? (warnings.length ? 'orange' : 'green') : 'red',
						message:
							errorHtml +
							warningHtml +
							checksHtml +
							(!errors.length && !warnings.length ? __('All checks passed.') : ''),
					});
				}

				resolve(result);
			},
			error: () => {
				frappe.msgprint({
					title: __('Verification Failed'),
					indicator: 'red',
					message: __('Unable to run verification right now.'),
				});
				resolve({ ok: false, errors: [__('Unable to run verification right now.')] });
			},
		});
	});
}

function remove_custom_image(frm) {
	frappe.confirm(
		__(
			'This will remove the Docker image from the linked server to free disk space. If any running container still depends on it, removal may fail. Continue?',
		),
		() => {
			frappe.call({
				method: 'enqueue_remove_custom_image',
				doc: frm.doc,
				callback: (r) => {
					if (r.message && r.message.status === 'queued') {
						frappe.msgprint({
							title: __('Removal Started'),
							message: __('Image removal has been queued successfully.'),
							indicator: 'orange',
						});
						frm.reload_doc();
					} else {
						frappe.msgprint({
							title: __('Removal Failed'),
							message:
								r.message?.error ||
								__('Failed to enqueue the image removal process.'),
							indicator: 'red',
						});
					}
				},
			});
		},
	);
}

function show_build_status_indicator(frm) {
	const status = frm.doc.build_status;
	let color;
	let message;

	switch (status) {
		case 'Building':
			color = 'orange';
			message = __('Build in Progress...');
			break;
		case 'Built':
			color = 'green';
			message = __('Image Built Successfully');
			break;
		case 'Failed':
			color = 'red';
			message = __('Build Failed');
			break;
		default:
			color = 'gray';
			message = __('Ready to Build');
			break;
	}

	frm.dashboard.add_indicator(message, color);
}

function preview_apps_json(frm) {
	frappe.call({
		method: 'preview_apps_json_for_form',
		doc: frm.doc,
		callback: (r) => {
			if (r.message?.success) {
				const data = r.message;
				const dialog = new frappe.ui.Dialog({
					title: __('Apps JSON Preview'),
					size: 'large',
					fields: [
						{
							fieldtype: 'HTML',
							fieldname: 'apps_summary',
							label: __('Apps Summary'),
						},
						{
							fieldtype: 'Code',
							fieldname: 'apps_json',
							label: __('Generated apps.json'),
							options: 'JSON',
							read_only: 1,
						},
						{
							fieldtype: 'Small Text',
							fieldname: 'base64_preview',
							label: __('Base64 (first 200 chars)'),
							read_only: 1,
						},
					],
				});

				let summary_html = `<div class="apps-summary">
					<p><strong>Total Apps:</strong> ${data.app_count}</p>
					<table class="table table-bordered">
						<thead><tr><th>App Name</th><th>Repository</th><th>Branch</th></tr></thead>
						<tbody>`;

				for (const app of data.apps_summary) {
					summary_html += `
						<tr>
							<td><code>${app.name}</code></td>
							<td><small>${app.url}</small></td>
							<td><span class="badge badge-info">${app.branch}</span></td>
						</tr>`;
				}

				summary_html += '</tbody></table></div>';

				dialog.set_value('apps_summary', summary_html);
				dialog.set_value('apps_json', data.apps_json);
				dialog.set_value(
					'base64_preview',
					`${data.apps_json_base64.substring(0, 200)}...`,
				);
				dialog.show();
			} else {
				frappe.msgprint({
					title: __('Preview Failed'),
					message:
						r.message?.error || __('Failed to generate apps.json preview'),
					indicator: 'red',
				});
			}
		},
	});
}
