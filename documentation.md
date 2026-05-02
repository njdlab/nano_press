# nano_press Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites & Installation](#prerequisites--installation)
4. [Initial Setup Workflow](#initial-setup-workflow)
5. [Server Management](#server-management)
6. [Apps Catalog](#apps-catalog)
7. [Hosting Plans](#hosting-plans)
8. [Custom Images](#custom-images)
9. [Frappe Sites](#frappe-sites)
10. [Site Subscriptions & Billing](#site-subscriptions--billing)
11. [Backups](#backups)
12. [Monitoring & Alerts](#monitoring--alerts)
13. [Recovery Wizard](#recovery-wizard)
14. [Ansible Playbook Reference](#ansible-playbook-reference)
15. [Troubleshooting](#troubleshooting)
16. [Known Limitations](#known-limitations)

---

## Overview

**nano_press** is a Frappe application that automates the deployment and lifecycle management of self-hosted Frappe/ERPNext sites using Docker and Ansible. It turns a Frappe desk into a full hosting control panel: provision worker servers, build custom Docker images pre-loaded with apps, spin up isolated Frappe bench instances, and manage the entire lifecycle from a single UI.

Key capabilities:
- One-click server provisioning (Docker + Traefik)
- Custom Docker image builder with arbitrary app combinations
- Automated site deployment with SSL via Traefik
- In-place app install / uninstall on live sites
- Scheduled backups with download and restore
- Real-time site health monitoring
- Disaster recovery wizard with full server scan and record import

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  nano_press Master Server                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Frappe App (nano_press)                             │   │
│  │  - Doctypes: Server, Frappe Site, Custom Image, Apps │   │
│  │  - Ansible Controller (paramiko / subprocess)        │   │
│  │  - Ansible Playbooks (/utils/ansible/playbooks/)     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │  SSH
          ┌──────────────┴──────────────┐
          ▼                             ▼
  ┌───────────────┐             ┌───────────────┐
  │  Worker A     │             │  Worker B     │
  │  Docker       │             │  Docker       │
  │  Traefik      │             │  Traefik      │
  │               │             │               │
  │  bench-0001/  │             │  bench-0003/  │
  │    frappe     │             │    frappe     │
  │    erpnext    │             │    hrms       │
  │  bench-0002/  │             └───────────────┘
  │    frappe     │
  └───────────────┘
```

**Components:**

| Layer | Technology | Role |
|---|---|---|
| Control Plane | Frappe (Python) | UI, business logic, job queue |
| Automation | Ansible | All server-side operations |
| Container Runtime | Docker + Compose | Site isolation |
| Reverse Proxy | Traefik | HTTP routing + Let's Encrypt SSL |
| Database | MariaDB (per site) | Site database |
| Cache/Queue | Redis (per site) | Background workers |
| Recovery Storage | `/var/lib/nano_press/recovery/` | Build manifests on each worker |

Each Frappe site runs as an independent Docker Compose stack. The stack is named after the bench (e.g. `BENCH-0001`) and consists of ~9 containers: `frontend`, `backend`, `scheduler`, `worker-short`, `worker-long`, `websocket`, `db`, `redis-cache`, `redis-queue`.

---

## Prerequisites & Installation

### Master Server Requirements

- Frappe Bench installed and running
- Python 3.10+
- Ansible installed (`pip install ansible`)
- SSH key pair (the master must be able to reach worker servers)

### Worker Server Requirements

- Ubuntu 22.04 or 24.04 (recommended)
- Accessible via SSH from the master server
- Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 8080 (Traefik dashboard)
- Minimum 2 CPU cores, 4 GB RAM per site you intend to host
- At least 20 GB disk space

### Installing nano_press

```bash
cd /home/master/frappe-bench
bench get-app nano_press https://github.com/njdlab/nano_press
bench --site <your-site> install-app nano_press
bench --site <your-site> migrate
```

---

## Initial Setup Workflow

The recommended first-time setup order is:

```
1. Add Server record
2. Prepare Server (installs Docker + Traefik)
3. Add Apps to the catalog (optional, for custom images)
4. Create Custom Image (optional, for non-default apps)
5. Create Frappe Site
6. Deploy Site
```

### Step 1 – Add a Server

Navigate to **nano_press → Server → New**.

| Field | Description |
|---|---|
| `server_ip` | IP address of the worker |
| `ssh_user` | SSH user (usually `root` or `master`) |
| `ssh_password` | SSH password (stored encrypted) |
| `ssh_port` | SSH port (default 22) |
| `server_name` | Human-readable label |

Save the record. The server status will show as "Not Verified" until you run **Verify Status**.

### Step 2 – Prepare Server

Open the Server record and click **Prepare Server**. This:

1. Installs Docker Engine via the official Docker APT repository
2. Installs `docker-compose-plugin` (the `docker compose` subcommand)
3. Deploys a Traefik reverse-proxy container configured for HTTP + HTTPS
4. Marks `docker_installed` and `traefik_deployed` on the Server record

All output is saved to an **Ansible Log** record for auditing.

> **Note:** If Docker is already installed on the server, run **Install Docker** separately instead of **Prepare Server** to skip Traefik.

### Step 3 – Add Apps (optional)

If you only need vanilla Frappe or ERPNext sites you can skip this and use the built-in `docker_image` field on a Frappe Site. Otherwise, go to **nano_press → Apps → New** for each additional app.

### Step 4 – Build a Custom Image (optional)

Go to **nano_press → Custom Image → New**, pick your apps, target server, and click **Build Image**.

### Step 5 – Create and Deploy a Frappe Site

Go to **nano_press → Frappe Site → New**, configure the site, and click **Deploy Site**.

---

## Server Management

### DocType: Server

**Path:** nano_press → Server

| Field | Type | Description |
|---|---|---|
| `server_name` | Data | Label for this worker |
| `server_ip` | Data | IP or hostname |
| `ssh_user` | Data | Login user |
| `ssh_password` | Password | Stored encrypted |
| `ssh_port` | Int | Default: 22 |
| `docker_installed` | Check | Set after Docker install |
| `traefik_deployed` | Check | Set after Traefik deploy |
| `verify_status` | Select | Not Verified / Verified / Error |
| `notes` | Text | Free-form notes |

### Available Actions (Buttons)

| Action | Playbook | Description |
|---|---|---|
| **Verify Status** | `check_server_status.yml` | Checks Docker, Compose, Traefik versions |
| **Prepare Server** | `prepare_server.yml` | Full server setup (Docker + Traefik) |
| **Install Docker** | `install_docker.yml` | Install Docker only (no Traefik) |
| **Install Traefik** | `install_traefik.yml` | Deploy Traefik only |
| **Stop All Containers** | `stop_all_containers.yml` | Emergency: stop every bench on this server |
| **Cleanup Storage** | `cleanup_server_storage.yml` | Free disk space (removes dangling images, stopped containers) |
| **View Metrics** | `server_metrics.yml` | Capture CPU, RAM, disk snapshot |

### Server Health Monitoring

nano_press periodically runs `server_metrics.yml` and creates **Server Metrics Snapshot** records. If a threshold is crossed, a **Server Health Alert** is created and can be used to trigger notifications.

---

## Apps Catalog

### DocType: Apps

**Path:** nano_press → Apps

Each record represents a Frappe application available to include in custom images or install on live sites.

| Field | Type | Description |
|---|---|---|
| `app_name` | Data | Unique identifier (e.g. `erpnext`) |
| `repo_url` | Data | Git repository URL |
| `branch` | Data | Git branch (e.g. `version-15`) |
| `pat_token` | Password | Private repo token (not stored in manifests) |
| `is_public` | Check | Public repo (no token needed) |
| `module_name` | Data | Auto-derived from repo URL (hidden field) |
| `order` | Int | Install order priority |

### Public vs Private Apps

- **Public apps** (is_public = 1): repo URL is used directly with no authentication.
- **Private apps** (is_public = 0): the `pat_token` is embedded in the `apps.json` at build time via `https://<token>@github.com/...`. The token is **never stored** in recovery manifests.

### Adding a Private App

1. Create a GitHub Personal Access Token (PAT) with `repo` scope.
2. Create a new Apps record, paste the repo URL (without token), enter the PAT in `pat_token`.
3. nano_press will construct the authenticated URL automatically when building images.

---

## Hosting Plans

### DocType: Hosting Plan

**Path:** nano_press → Hosting Plan

Hosting Plans define tiers of service sold to customers. They can be associated with a specific set of pre-approved apps and resource quotas.

| Field | Description |
|---|---|
| `plan_name` | Display name (e.g. "Starter", "Business") |
| `apps` | Child table: allowed apps for this plan |
| `price` | Monthly price |
| `description` | Marketing copy |

Hosting Plans are referenced by **Site Subscription** records when billing customers.

---

## Custom Images

### DocType: Custom Image

**Path:** nano_press → Custom Image

A Custom Image is a Docker image built on a specific worker server that has Frappe plus one or more additional apps pre-installed. Sites that use a Custom Image start instantly without needing to install apps during deployment.

### Lifecycle

```
New → Configure Apps → Build Image → [In Use by Sites] → (optionally) Remove Image
```

### Fields

| Field | Type | Description |
|---|---|---|
| `image_name` | Data | Docker image name (e.g. `frappe-custom`) |
| `image_tag` | Data | Image tag (e.g. `v15-erpnext-hrms`) |
| `frappe_version` | Data | Frappe version tag / branch |
| `server_name` | Link → Server | Worker where the image is built and stored |
| `build_status` | Select | Pending / Building / Success / Failed |
| `apps_config` | Child Table | App records included in this image |
| `apps_json_base64` | Text | Base64-encoded `apps.json` (auto-generated) |
| `docker_image_id` | Data | Full image ID after build |
| `built_at` | Datetime | Build timestamp |

### Apps Config Child Table (App Install Item)

Each row in `apps_config` maps to an entry in the `apps.json` passed to `frappe_docker`:

| Field | Description |
|---|---|
| `app_name` | Link → Apps catalog |
| `repo_url` | Resolved URL (with PAT if private) |
| `branch` | Git branch |

### Building a Custom Image

1. Create a new Custom Image record.
2. Set `image_name`, `image_tag`, `frappe_version`, `server_name`.
3. Add rows to `apps_config` for each app to include.
4. Click **Build Image**.

The build process:
1. Runs `build_custom_image.yml` on the target worker.
2. Clones `frappe/frappe_docker` if not present.
3. Renders an `apps.json` from `apps_json_base64`.
4. Runs `docker build` using the frappe_docker containerized build approach.
5. On success, persists a **recovery manifest** to `/var/lib/nano_press/recovery/custom_images/<tag>.json`.
6. Updates `build_status`, `docker_image_id`, `built_at` on the record.

### Recovery Manifest

After a successful build, nano_press writes a JSON manifest on the worker:

```json
{
  "manifest_version": "1.0",
  "image_tag": "v15-erpnext-hrms",
  "image_name": "frappe-custom",
  "frappe_version": "version-15",
  "apps_json_base64": "<base64>",
  "apps_config": [
    {
      "app_name": "erpnext",
      "repo_url": "https://github.com/frappe/erpnext",
      "branch": "version-15"
    }
  ],
  "generated_at": "2026-05-02T10:00:00",
  "image_id": "sha256:abc123...",
  "built_at": "2026-05-02T10:05:00"
}
```

> **Security:** PAT tokens are never written to the manifest. Private repo URLs are stored without the token prefix.

### Removing a Custom Image

Click **Remove Image** on the Custom Image record. This runs `remove_custom_image.yml` which deletes the Docker image from the worker. The record remains in Frappe for audit purposes.

---

## Frappe Sites

### DocType: Frappe Site

**Path:** nano_press → Frappe Site

The central doctype. Each record represents one deployed (or to-be-deployed) Frappe bench on a worker server.

### Naming

Sites are auto-named with the pattern `BENCH-{####}` (e.g. `BENCH-0001`).

### Fields

| Field | Type | Description |
|---|---|---|
| `site_url` | Data | Fully-qualified domain (e.g. `client.example.com`) |
| `server_name` | Link → Server | Target worker server |
| `bench_name` | Data | Auto-set from naming (e.g. `BENCH-0001`) |
| `status` | Select | See statuses below |
| `ssl_enabled` | Check | Provision Let's Encrypt cert via Traefik |
| `custom_image` | Link → Custom Image | Optional: use a pre-built image |
| `docker_image` | Data | Fallback image if no custom image (e.g. `frappe/erpnext:v15`) |
| `admin_password` | Password | Frappe administrator password |
| `db_username` | Data | MariaDB username for this site |
| `db_password` | Password | MariaDB password |
| `install_apps` | Child Table | Apps to install during deployment (links to Apps catalog) |
| `customer` | Link → Customer | ERPNext customer (for billing) |
| `frappe_version` | Data | Frappe version (informational) |
| `deployment_notes` | Text | Free-form notes |

### Site Statuses

| Status | Meaning |
|---|---|
| Draft | Not yet deployed |
| Preparing | Deployment in progress |
| Active | Running and accessible |
| Stopped | Containers stopped |
| Error | Last operation failed |
| Destroyed | Site removed from worker |

### Deploying a Site

1. Create a new Frappe Site record.
2. Set `site_url` (must resolve to the worker's IP for SSL to work).
3. Choose `server_name`.
4. Optionally select a `custom_image` or set `docker_image` directly.
5. Add rows to `install_apps` for any apps to install at startup (only needed when not using a custom image that already includes them).
6. Set `admin_password`, `db_username`, `db_password`.
7. Toggle `ssl_enabled` if you have DNS pointing to the server.
8. Click **Deploy Site**.

Deployment sequence (orchestrated by Ansible):

```
prepare_repo.yml      → Clone frappe_docker repo on worker
render_pwd.yml        → Write docker-compose.yml + .env to bench directory
compose_up.yml        → docker compose up -d
                          Wait for 9 containers to be running
                          Wait for 3 consecutive HTTP 200 responses
```

### Available Site Actions

| Action | Playbook | Description |
|---|---|---|
| **Deploy Site** | compose_up.yml | Initial deployment |
| **Check Status** | site_runtime_status.yml | Are containers up? HTTP ok? |
| **Restart Site** | restart_site.yml | `docker compose restart` |
| **Install App** | manage_site_app.yml | Install app on live site |
| **Uninstall App** | manage_site_app.yml | Uninstall app from live site |
| **List Installed Apps** | list_site_apps.yml | List apps in running site |
| **Rebuild Assets** | rebuild_site_assets.yml | Run `bench build` |
| **Set Maintenance Mode** | set_maintenance_mode.yml | Toggle maintenance page |
| **Reset Admin Password** | reset_admin_password.yml | Reset `/administrator` password |
| **Create Backup** | manage_site_backup.yml | Full site backup (DB + files) |
| **List Backups** | list_site_backups.yml | Show available backups |
| **Download Backup** | download_site_backup_file.yml | Fetch backup archive to master |
| **Delete Backup** | delete_site_backup_directory.yml | Remove backup from worker |
| **Destroy Site** | destroy_site.yml | Stop containers, remove bench directory |

### Installing / Uninstalling Apps on a Live Site

From the Frappe Site form:

1. Click **Install App** (or **Uninstall App**).
2. Select the app from the Apps catalog.
3. nano_press runs `manage_site_app.yml` which exec's into the `backend` container and runs `bench install-app <app>`.

> This works only when the app is already present in the Docker image. To add an app not in the image, you need to build a new Custom Image and redeploy.

---

## Site Subscriptions & Billing

### DocType: Site Subscription

**Path:** nano_press → Site Subscription

Links a customer (ERPNext Customer doctype) to a Frappe Site and a Hosting Plan for billing purposes.

| Field | Description |
|---|---|
| `customer` | Link → Customer |
| `frappe_site` | Link → Frappe Site |
| `hosting_plan` | Link → Hosting Plan |
| `start_date` | Subscription start |
| `end_date` | Subscription end (blank = ongoing) |
| `status` | Active / Cancelled / Expired |

Subscriptions are informational in nano_press — actual invoice generation is done through ERPNext's subscription module or a custom billing workflow.

---

## Backups

### Creating a Backup

From the Frappe Site form, click **Create Backup**. This runs `manage_site_backup.yml` which:

1. Exec's into the `backend` container.
2. Runs `bench --site <site> backup --with-files`.
3. Stores the archive under `/home/<ssh_user>/frappe-docker/<bench>/backups/` on the worker.
4. Records the backup path in the Ansible Log.

### Listing Backups

Click **List Backups** to see available backup directories on the worker.

### Downloading a Backup

Click **Download Backup** and select the backup directory. The archive is transferred to the master server via SFTP.

### Deleting a Backup

Click **Delete Backup** to remove a backup directory from the worker, freeing disk space.

---

## Monitoring & Alerts

### Server Metrics Snapshot

nano_press can be configured to run `server_metrics.yml` on a schedule. Each run creates a **Server Metrics Snapshot** record with:

- CPU usage %
- RAM used / total
- Disk used / total
- Timestamp

### Server Health Alert

When a metric exceeds a threshold (configurable), a **Server Health Alert** record is created. You can build a notification rule in Frappe that emails administrators when an alert is created.

### Ansible Log

Every playbook execution creates an **Ansible Log** record with:

| Field | Description |
|---|---|
| `doctype_link` | Which doctype triggered the run |
| `document_name` | Which record triggered the run |
| `playbook` | Playbook filename |
| `status` | Success / Failed |
| `output` | Full stdout/stderr from Ansible |
| `executed_at` | Timestamp |

Use Ansible Logs as the primary debug tool when an operation fails.

---

## Recovery Wizard

The Recovery Wizard is a Frappe **Page** (not a doctype) that guides you through disaster recovery when a nano_press master database is lost but worker servers still have running sites and/or custom images.

**Path:** nano_press → Recovery Wizard (in the sidebar)

### When to Use

- Master Frappe database was corrupted or lost
- Server records, Frappe Site records, or Custom Image records were accidentally deleted
- Migrating nano_press to a new master server

### Wizard Steps

#### Step 1 – Scan Servers

Before scanning, if you have Custom Image records in the DB but no manifests on the workers (e.g. images built before the manifest feature was added), click **Backfill Manifests**. This reads every Custom Image record and writes a recovery manifest file to the corresponding worker.

Click **Scan All Servers** to run `scan_server.yml` on every Server record. The scan collects:

- All Docker images on the worker
- For each image: checks `/var/lib/nano_press/recovery/custom_images/<tag>.json` and attaches the manifest if found
- All Docker Compose stacks (bench directories)
- For each stack: reads the `.env` file for site URL, credentials, and installed apps

Results are displayed grouped by server.

#### Step 2 – Review & Select

Two tables are shown:

**Custom Images table:**

| Column | Description |
|---|---|
| Server | Worker server |
| Image Name | Docker image name |
| Image Tag | Docker image tag |
| Manifest | ✓ (manifest found) or ✗ |
| Already Exists | Already in DB? |
| Import | Checkbox |

**Sites table:**

| Column | Description |
|---|---|
| Server | Worker server |
| Bench Name | Bench directory name |
| Site URL | Frappe site URL |
| Installed Apps | Comma-separated list |
| Already Exists | Already in DB? |
| Import | Checkbox |

Uncheck any records you don't want to import. By default all new (not-already-existing) records are checked.

#### Step 3 – Import & Results

Click **Import Selected**. nano_press will:

1. **For each selected Custom Image:**
   - Create a new Custom Image record
   - If manifest found: restore `apps_config` child rows and `apps_json_base64`
   - If no manifest: create the record with empty apps config (can be edited later)
   - Auto-create any missing Apps catalog entries from the manifest

2. **For each selected Site:**
   - Create a new Frappe Site record with `status = Active`
   - Restore `site_url`, `server_name`, `bench_name`
   - Restore `install_apps` child rows from `.env` data
   - Credentials are left blank (cannot be recovered from the worker)

Results are shown as a summary of created records with links to open each one.

### Backfill Manifests

The **Backfill Manifests** button (Step 1 area) runs `backfill_recovery_manifests.yml` on all servers for all Custom Image records currently in the database. Use this to retroactively create manifest files on workers for images that were built before the manifest persistence feature was introduced.

---

## Ansible Playbook Reference

All playbooks are in `nano_press/utils/ansible/playbooks/`.

### Server Setup

| Playbook | Variables | Description |
|---|---|---|
| `prepare_server.yml` | `server_ip`, `ssh_user`, `ssh_password` | Install Docker + deploy Traefik |
| `install_docker.yml` | `server_ip`, `ssh_user`, `ssh_password` | Install Docker Engine via official APT repo |
| `install_traefik.yml` | `server_ip`, `ssh_user`, `ssh_password` | Deploy Traefik container |
| `check_server_status.yml` | `server_ip`, `ssh_user`, `ssh_password` | Report Docker/Compose/Traefik versions |

### Image Management

| Playbook | Variables | Description |
|---|---|---|
| `build_custom_image.yml` | `image_name`, `image_tag`, `frappe_version`, `apps_json_b64` | Build image + write recovery manifest |
| `remove_custom_image.yml` | `image_name`, `image_tag` | Remove Docker image from worker |
| `backfill_recovery_manifests.yml` | `manifests` (list) | Write manifest JSON files to worker |

### Site Lifecycle

| Playbook | Variables | Description |
|---|---|---|
| `prepare_repo.yml` | `bench_name` | Clone frappe_docker on worker |
| `render_pwd.yml` | `bench_name`, `site_url`, `docker_image`, `install_apps`, `ssl_enabled`, `db_username`, `db_password`, `admin_password` | Render docker-compose + .env |
| `compose_up.yml` | `bench_name`, `site_url` | `docker compose up -d`, wait for health |
| `destroy_site.yml` | `bench_name` | Stop containers, remove bench directory |
| `restart_site.yml` | `bench_name` | `docker compose restart` |
| `site_runtime_status.yml` | `bench_name`, `site_url` | Check running containers + HTTP 200 |

### App Management

| Playbook | Variables | Description |
|---|---|---|
| `manage_site_app.yml` | `bench_name`, `app_name`, `action` (install/uninstall) | Install or uninstall app on live site |
| `list_site_apps.yml` | `bench_name` | List installed apps |
| `rebuild_site_assets.yml` | `bench_name` | `bench build` |

### Site Operations

| Playbook | Variables | Description |
|---|---|---|
| `set_maintenance_mode.yml` | `bench_name`, `mode` (on/off) | Toggle maintenance mode |
| `reset_admin_password.yml` | `bench_name`, `new_password` | Reset admin password |
| `stop_all_containers.yml` | (none beyond SSH) | Stop all bench containers on server |
| `cleanup_server_storage.yml` | (none beyond SSH) | Prune Docker resources |

### Backup

| Playbook | Variables | Description |
|---|---|---|
| `manage_site_backup.yml` | `bench_name`, `site_fqdn` | Create full backup |
| `list_site_backups.yml` | `bench_name` | List backup directories |
| `download_site_backup_file.yml` | `bench_name`, `backup_dir` | Download backup archive to master |
| `delete_site_backup_directory.yml` | `bench_name`, `backup_dir` | Delete backup from worker |

### Monitoring & Recovery

| Playbook | Variables | Description |
|---|---|---|
| `server_metrics.yml` | (none beyond SSH) | Collect CPU/RAM/disk metrics |
| `provision_bench.yml` | `bench_name` | Initial bench provisioning |
| `scan_server.yml` | (none beyond SSH) | Full server scan: images + sites + manifests |

### Jinja2 Templates

Templates are in `nano_press/utils/ansible/templates/`.

| Template | Used By | Description |
|---|---|---|
| `pwd.withssl.yml.j2` | `render_pwd.yml` | docker-compose with Traefik SSL labels |
| `pwd.withoutssl.yml.j2` | `render_pwd.yml` | docker-compose without SSL |
| `env.j2` | `render_pwd.yml` | `.env` file with site credentials |

Both docker-compose templates use `${INSTALL_APPS:-}` (empty default) so that a vanilla Frappe deployment with no extra apps is started correctly without accidentally installing ERPNext.

---

## Troubleshooting

### Site stuck at "Preparing"

1. Open the Ansible Log for the last operation on this site.
2. Look for errors in the `compose_up.yml` output.
3. Common causes:
   - Incorrect credentials in `.env` — check `db_password` / `admin_password` have no special shell characters unescaped.
   - Worker out of disk space — run **Cleanup Storage** on the Server.
   - Image not present on worker — if using a custom image, verify the build succeeded on the same server.

### Docker install fails on worker

The `install_docker.yml` playbook uses the official Docker APT repository. If the worker has a stale GPG key or conflicting Docker packages, check the Ansible Log output. You may need to manually remove old packages (`docker.io`, `docker-engine`) before re-running.

### SSL cert not issued

- Verify DNS points the site URL to the worker IP before deploying with `ssl_enabled`.
- Check Traefik dashboard (port 8080 on the worker) for certificate errors.
- Let's Encrypt rate limits apply (5 certs per domain per week).

### Custom image build fails

1. Check the Ansible Log for the Custom Image record.
2. Common causes:
   - Private repo token expired or incorrect — update the PAT in the Apps catalog.
   - Worker has no internet access — frappe_docker needs to pull base images.
   - frappe_docker repo is outdated — delete `/home/<ssh_user>/frappe-docker` on the worker and retry.

### Recovery Wizard shows no images

- Ensure all Server records have correct SSH credentials.
- Run **Verify Status** on each server first.
- Check that the scan Ansible Log shows no SSH connection errors.

### App install on live site fails

- The app must already be present in the Docker image. You cannot install an app that wasn't in the image at build time.
- If you need a new app, build a new Custom Image and redeploy the site.

---

## Known Limitations

### Fork Naming (apps with different module names)

When an app is forked and the Python module name differs from the `app_name` in the Apps catalog, nano_press may derive the wrong module name. The `module_name` field on the Apps doctype is auto-derived from the repo URL slug. For apps where the module name differs from the repo slug, manually set `module_name` after creating the Apps record.

### Deployment Progress Stall at ~90%

During the `compose_up.yml` health check phase (waiting for HTTP 200 responses), the progress indicator may stall near 90% for several minutes on first deployment while Frappe runs migrations and builds assets. This is expected behavior — do not cancel the operation. The site will become active once migrations complete.

### Credentials Not Recoverable

When the Recovery Wizard imports a Frappe Site from a worker scan, the `admin_password`, `db_username`, and `db_password` fields cannot be recovered (they are not stored in plaintext on the worker). After recovery, reset the admin password using the **Reset Admin Password** action, and retrieve DB credentials from the worker's `.env` file manually.

### No Multi-Server Image Distribution

A Custom Image built on Server A is not automatically available on Server B. If you want the same image on multiple workers, you need to build it separately on each or implement a private Docker registry manually.

### Traefik Wildcard SSL

Traefik is configured for per-domain Let's Encrypt certificates. Wildcard certificates (e.g. `*.example.com`) require DNS-01 challenge configuration which is not currently automated by nano_press.
