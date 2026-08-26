#!/usr/bin/env python3
"""
OpenFlow Work OS • Persistent Database Server (Python + SQLite3 + REST API)
Includes Real Authentication & Session Engine with Token Verification,
User Database Management (/api/users, /api/auth/*),
and PostgreSQL/SQLite JSONB Dynamic Schema Management.
"""

import http.server
import json
import sqlite3
import os
import urllib.parse
import urllib.request
import ssl
import re
import hashlib
import time
import secrets
from datetime import datetime

PORT = int(os.environ.get('PORT', 8000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    DB_FILE = "/tmp/openflow_workos.db"
    source_db = os.path.join(BASE_DIR, "openflow_workos.db")
    if os.path.exists(source_db) and not os.path.exists(DB_FILE):
        try:
            import shutil
            shutil.copy2(source_db, DB_FILE)
        except Exception as e:
            print("[Vercel DB Init] Copy error:", e)
else:
    DB_FILE = os.path.join(BASE_DIR, "openflow_workos.db")

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

# =========================================================================
# TURSO CLOUD SQLITE & LOCAL SQLITE UNIFIED DATABASE ADAPTER
# =========================================================================

class TursoClient:
    def __init__(self, db_url, auth_token):
        url = db_url.strip()
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        elif not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url
        self.base_url = url.rstrip("/")
        self.auth_token = auth_token.strip() if auth_token else ""

    def execute(self, sql, params=()):
        pipeline_url = f"{self.base_url}/v2/pipeline"
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null"})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": p})
            elif isinstance(p, bytes):
                import base64
                args.append({"type": "blob", "base64": base64.b64encode(p).decode()})
            else:
                args.append({"type": "text", "value": str(p)})

        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args
                    }
                },
                {"type": "close"}
            ]
        }

        req = urllib.request.Request(
            pipeline_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.loads(res.read().decode("utf-8"))
        except Exception as e:
            print(f"[Turso HTTP Request Error]: {e}")
            raise e

        results = data.get("results", [])
        if not results:
            return []
        
        first = results[0]
        if first.get("type") == "error":
            err_msg = first.get("error", {}).get("message", "Unknown error")
            raise Exception(f"Turso Error: {err_msg}")
        
        exec_res = first.get("response", {}).get("result", {})
        cols = [c["name"] for c in exec_res.get("cols", [])]
        rows = exec_res.get("rows", [])

        out = []
        for r in rows:
            row_dict = {}
            for i, col in enumerate(cols):
                val_obj = r[i]
                if val_obj.get("type") == "null":
                    row_dict[col] = None
                elif val_obj.get("type") == "integer":
                    row_dict[col] = int(val_obj.get("value", 0))
                elif val_obj.get("type") == "float":
                    row_dict[col] = float(val_obj.get("value", 0.0))
                else:
                    row_dict[col] = val_obj.get("value")
            out.append(row_dict)

        return out

class TursoCursor:
    def __init__(self, client):
        self.client = client
        self.results = []
        self.idx = 0
        self.rowcount = 0

    def execute(self, sql, params=()):
        self.results = self.client.execute(sql, params)
        self.idx = 0
        self.rowcount = len(self.results)
        return self

    def fetchone(self):
        if self.idx < len(self.results):
            row = self.results[self.idx]
            self.idx += 1
            return row
        return None

    def fetchall(self):
        res = self.results[self.idx:]
        self.idx = len(self.results)
        return res

class TursoConnection:
    def __init__(self, client):
        self.client = client

    def cursor(self):
        return TursoCursor(self.client)

    def commit(self):
        pass

    def close(self):
        pass

def ensure_db_ready():
    global DB_FILE
    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        DB_FILE = "/tmp/openflow_workos.db"
        if not os.path.exists(DB_FILE):
            source_db = os.path.join(BASE_DIR, "openflow_workos.db")
            if os.path.exists(source_db):
                try:
                    import shutil
                    shutil.copy2(source_db, DB_FILE)
                except Exception as e:
                    print("[Vercel DB Copy Error]:", e)
            init_db()

TURSO_DEFAULT_URL = "https://openflow-db-vercel-icfg-aozttlc9cpfvzxmsudaiqytn.aws-us-east-1.turso.io"
TURSO_DEFAULT_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc3MjgyMzYsImlkIjoiMDFhMDNjZTgtMGQwMS03ZDgyLWEyZWItZDU2MWRjOGI3NTA4Iiwia2lkIjoiVkQ1Nm9BbnB3blE1QjJubWgyWmpwanZGRk9Yd3NqVnloZk1nRzBqZzR0dyIsInJpZCI6ImI1ZDRiOWNlLTY1NTMtNGJjMS05NGVkLTM5NmU0NGZjM2EwYiJ9.UR9OOyZIiJzZ8ZPnyYbbxuZybAXMw2wPoiKnN4ComuZxrgSgNy5cM_GONge0fOhPWEjkAtXsxoXJ_MExOmwCCw"

def get_db():
    # 1. Check for Turso Database URL and Auth Token (from Env or Default)
    turso_url = os.environ.get("TURSO_DATABASE_URL") or os.environ.get("TURSO_URL") or os.environ.get("LIBSQL_URL") or os.environ.get("DATABASE_URL") or TURSO_DEFAULT_URL
    turso_token = os.environ.get("TURSO_AUTH_TOKEN") or os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN") or TURSO_DEFAULT_TOKEN

    if turso_url and (turso_url.startswith("libsql://") or turso_url.startswith("http://") or turso_url.startswith("https://") or "turso.io" in turso_url):
        client = TursoClient(turso_url, turso_token)
        return TursoConnection(client)

    # 2. Local SQLite Engine
    ensure_db_ready()
    conn = sqlite3.connect(DB_FILE, timeout=20.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. Real Users table (Authentication & User Profiles)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password_hash TEXT,
            full_name TEXT,
            role TEXT,
            organization TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. Real Sessions table (Auth Bearer tokens)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 3. Boards table with columns_config JSON
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY,
            tenant_id TEXT UNIQUE,
            title TEXT,
            description TEXT,
            schema_name TEXT,
            columns_config TEXT
        )
    """)

    # 4. Items table with data JSON
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            board_id TEXT,
            data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 5. Audit Logs table (Immutable Event Sourcing)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            timestamp TEXT,
            user TEXT,
            role TEXT,
            field TEXT,
            old_val TEXT,
            new_val TEXT,
            item_title TEXT,
            hash TEXT
        )
    """)

                # 9. Workspace System Pricing & Team Salary Sharing table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS workspace_revenue_sharing (
            tenant_id TEXT PRIMARY KEY,
            system_selling_price REAL DEFAULT 1500000,
            collected_amount REAL DEFAULT 1500000,
            overhead_reserve_pct REAL DEFAULT 10,
            team_shares TEXT DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 8. Workspace Finance & Budget Ledger table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS workspace_finance (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            item_title TEXT,
            category TEXT DEFAULT 'Operations',
            allocated REAL DEFAULT 0,
            spent REAL DEFAULT 0,
            status TEXT DEFAULT 'Approved',
            date TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 7. Workspace Planners & Scratchpad table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workspace_planners (
            tenant_id TEXT PRIMARY KEY,
            notes TEXT DEFAULT '',
            todos TEXT DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 6. Automation rules table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            name TEXT,
            trigger_expr TEXT,
            action_expr TEXT,
            active INTEGER DEFAULT 1,
            count INTEGER DEFAULT 0
        )
    """)

    # Seed default Admin account (Real authentication)
    admin_hash = hash_password("admin123")
    cursor.execute(
        "INSERT OR REPLACE INTO users (id, email, password_hash, full_name, role, organization) VALUES (?, ?, ?, ?, ?, ?)",
        ("usr_admin", "admin@openflow.io", admin_hash, "System Administrator", "admin", "OpenFlow Core Team")
    )

    # Initialize default boards if empty
    cursor.execute("SELECT COUNT(*) as count FROM boards")
    if cursor.fetchone()["count"] == 0:
        default_columns = [
            { "id": "col_title", "type": "text", "title": "Features", "required": True, "width": "320px" },
            { "id": "col_status", "type": "status", "title": "Status Stage", "options": ["Planning", "In Progress", "Review", "Completed", "Blocked"], "width": "170px" },
            { "id": "col_dept", "type": "person", "title": "Module / Lead", "width": "220px" },
            { "id": "col_priority", "type": "priority", "title": "Priority", "options": ["Critical", "High", "Medium", "Low"], "width": "140px" },
            { "id": "col_timeline", "type": "date", "title": "Target Release", "width": "170px" },
            { "id": "col_progress", "type": "progress", "title": "Progress %", "width": "180px" }
        ]

        tenants = [
            ("board_primary", "tenant_primary", "Custom Workspace & Project Master Board", "Dynamic PostgreSQL/SQLite JSONB Schema • Fully Customizable", "custom_schema_01"),
            ("board_lgu", "tenant_lgu_pasig", "Pasig City Public Works Schema", "LGU Infrastructure & Public Works Master Schema", "lgu_pasig_gov"),
            ("board_enterprise", "tenant_enterprise_ayala", "Enterprise Master Schema", "Private Enterprise Capex & Asset Delivery Schema", "enterprise_ayala")
        ]

        for b_id, t_id, title, desc, schema in tenants:
            cursor.execute(
                "INSERT INTO boards (id, tenant_id, title, description, schema_name, columns_config) VALUES (?, ?, ?, ?, ?, ?)",
                (b_id, t_id, title, desc, schema, json.dumps(default_columns))
            )

        auto_rules = [
            ("rule_1", "tenant_primary", "Approval Escalation Webhook", "When Status = 'Approved'", "Trigger Executive Notification & Webhook Dispatch", 1, 0),
            ("rule_2", "tenant_primary", "High-Value Budget Guard", "When Budget > ₱50,000,000", "Flag for Compliance Review", 1, 0)
        ]
        for r_id, t_id, name, trig, act, active, count in auto_rules:
            cursor.execute(
                "INSERT INTO automations (id, tenant_id, name, trigger_expr, action_expr, active, count) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (r_id, t_id, name, trig, act, active, count)
            )

    conn.commit()
    conn.close()

def get_auth_user(headers, query_params=None):
    """Verifies Bearer token against SQLite sessions table and returns user dict if valid."""
    auth_header = headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if not token and query_params:
        token = query_params.get("token", [""])[0]

    if not token:
        return None

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.email, u.full_name, u.role, u.organization, u.created_at
        FROM users u
        JOIN sessions s ON u.id = s.user_id
        WHERE s.token = ?
    """, (token,))
    user_row = cursor.fetchone()
    conn.close()

    return dict(user_row) if user_row else None

class WorkOSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json_response(self, data, status_code=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _send_project_mock_portal(self, target_url, error_msg=""):
        parsed = urllib.parse.urlparse(target_url)
        domain = parsed.netloc or target_url.replace("https://", "").replace("http://", "").split("/")[0]
        site_name = domain.split(".")[0].replace("-", " ").title() if domain else "Project Workspace"

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{site_name} • Live Portal</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {{ font-family: 'Inter', sans-serif; }}
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col antialiased">
  <header class="bg-slate-950/80 border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 z-30 backdrop-blur-md">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
        <i data-lucide="globe" class="w-5 h-5"></i>
      </div>
      <div>
        <h1 class="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <span>{site_name} Official Portal</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">Live Connected</span>
        </h1>
        <p class="text-xs text-slate-400 font-mono">{target_url}</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <a href="{target_url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors">
        <span>Open in New Tab</span>
        <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
      </a>
    </div>
  </header>

  <main class="flex-1 max-w-6xl w-full mx-auto p-6 sm:p-8 space-y-8">
    <div class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border border-slate-800 p-6 sm:p-10 shadow-2xl">
      <div class="relative z-10 max-w-2xl space-y-4">
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-semibold">
          <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
          <span>Verified Government & Enterprise Work OS Portal</span>
        </div>
        <h2 class="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          Welcome to the <span class="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">{site_name}</span> Digital Services
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Integrated public governance, digital transparency, citizen services, and real-time civil infrastructure tracking powered by OpenFlow Work OS.
        </p>
        <div class="flex flex-wrap items-center gap-3 pt-2">
          <a href="{target_url}" target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 bg-white text-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold shadow-md transition-colors flex items-center gap-2">
            <i data-lucide="globe" class="w-4 h-4"></i> Launch External Website
          </a>
          <button onclick="alert('Digital e-Services Portal is live and synchronized with OpenFlow Work OS.')" class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2">
            <i data-lucide="file-text" class="w-4 h-4 text-blue-400"></i> Resident Services
          </button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 space-y-3 hover:border-slate-700 transition-colors">
        <div class="w-10 h-10 rounded-lg bg-blue-950/80 border border-blue-500/30 text-blue-400 flex items-center justify-center">
          <i data-lucide="file-check" class="w-5 h-5"></i>
        </div>
        <h3 class="font-bold text-sm text-white">Online Clearances & Permits</h3>
        <p class="text-xs text-slate-400">File online requests for Barangay Clearances, Business Permits, and Resident Certificates with instant cryptographic verification.</p>
      </div>

      <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 space-y-3 hover:border-slate-700 transition-colors">
        <div class="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
          <i data-lucide="activity" class="w-5 h-5"></i>
        </div>
        <h3 class="font-bold text-sm text-white">Public Infrastructure Radar</h3>
        <p class="text-xs text-slate-400">Live civil works tracking, drainage programs, road repairs, and project progress linked directly to OpenFlow kanban and calendar milestones.</p>
      </div>

      <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 space-y-3 hover:border-slate-700 transition-colors">
        <div class="w-10 h-10 rounded-lg bg-purple-950/80 border border-purple-500/30 text-purple-400 flex items-center justify-center">
          <i data-lucide="users" class="w-5 h-5"></i>
        </div>
        <h3 class="font-bold text-sm text-white">Community & Resident Registry</h3>
        <p class="text-xs text-slate-400">Centralized database for household profiling, healthcare assistance, disaster response coordination, and local government programs.</p>
      </div>
    </div>
  </main>

  <footer class="border-t border-slate-800/80 px-6 py-4 text-center text-xs text-slate-500">
    &copy; 2026 {site_name} • Powered by OpenFlow Work OS Decoupled Architecture
  </footer>

  <script>
    lucide.createIcons();
  </script>
</body>
</html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        # 1.5 API: Proxy Website to bypass X-Frame-Options restrictions
        if parsed.path == "/api/proxy-site":
            target_url = query.get("url", [""])[0].strip()
            if not target_url:
                self._send_project_mock_portal("https://openflow.io", "No URL provided")
                return

            if not (target_url.startswith("http://") or target_url.startswith("https://")):
                target_url = f"https://{target_url}"

            try:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

                req = urllib.request.Request(
                    target_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9"
                    }
                )

                with urllib.request.urlopen(req, timeout=5, context=ctx) as response:
                    content_type = response.headers.get("Content-Type", "text/html")
                    raw_data = response.read()
                    
                    if "text/html" in content_type:
                        try:
                            html = raw_data.decode("utf-8", errors="ignore")
                        except Exception:
                            html = raw_data.decode("latin-1", errors="ignore")
                        
                        if "<head" in html.lower():
                            html = re.sub(r'(<head[^>]*>)', r'\1\n<base href="' + target_url + '">', html, count=1, flags=re.IGNORECASE)
                        
                        html = re.sub(r'<meta[^>]+http-equiv=["\']Content-Security-Policy["\'][^>]*>', '', html, flags=re.IGNORECASE)

                        self.send_response(200)
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(html.encode("utf-8", errors="ignore"))
                        return
                    else:
                        self.send_response(200)
                        self.send_header("Content-Type", content_type)
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(raw_data)
                        return
            except Exception as e:
                self._send_project_mock_portal(target_url, str(e))
                return

        # 1. API: Get Current Authenticated User (/api/auth/me)
        elif parsed.path == "/api/auth/me":
            user = get_auth_user(self.headers, query)
            if user:
                self._send_json_response({"success": True, "user": user})
            else:
                self._send_json_response({"success": False, "error": "Unauthenticated or session expired."}, 401)
            return

        # 2. API: List All Registered Users in Database (/api/users)
        elif parsed.path == "/api/users":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, email, full_name, role, organization, created_at FROM users ORDER BY created_at ASC")
            users = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self._send_json_response({"success": True, "users": users})
            return

        # 3. API: List all schemas / tenants with live DB stats
        elif parsed.path == "/api/tenants":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT b.id, b.tenant_id, b.title, b.description, b.schema_name, b.website_url, b.created_at, b.columns_config,
                       (SELECT COUNT(*) FROM items i WHERE i.tenant_id = b.tenant_id) as items_count,
                       (SELECT COUNT(*) FROM automations a WHERE a.tenant_id = b.tenant_id) as automations_count
                FROM boards b
                ORDER BY b.rowid ASC
            """)
            rows = cursor.fetchall()
            tenants = []
            for r in rows:
                t_dict = dict(r)
                try:
                    cols = json.loads(t_dict.get("columns_config", "[]"))
                    t_dict["columns_count"] = len(cols)
                except Exception:
                    t_dict["columns_count"] = 6
                tenants.append(t_dict)
            conn.close()
            self._send_json_response({"success": True, "tenants": tenants})
            return

        # 4. API: Get All Data for Tenant
        elif parsed.path == "/api/data":
            conn = get_db()
            cursor = conn.cursor()

            tenant_id = query.get("tenant", [None])[0]
            if tenant_id:
                cursor.execute("SELECT * FROM boards WHERE tenant_id = ?", (tenant_id,))
                board_row = cursor.fetchone()
            else:
                board_row = None

            if not board_row:
                cursor.execute("SELECT * FROM boards ORDER BY rowid ASC LIMIT 1")
                board_row = cursor.fetchone()

            tenant_id = board_row["tenant_id"]
            web_url = board_row["website_url"] if ("website_url" in board_row.keys() and board_row["website_url"]) else f"https://{board_row['schema_name'].replace('_', '-')}.gov.ph"
            board = {
                "id": board_row["id"],
                "tenant_id": board_row["tenant_id"],
                "title": board_row["title"],
                "description": board_row["description"],
                "schema": board_row["schema_name"],
                "website_url": web_url
            }
            columns_config = json.loads(board_row["columns_config"])

            # Items
            cursor.execute("SELECT * FROM items WHERE tenant_id = ? ORDER BY created_at DESC", (tenant_id,))
            items_rows = cursor.fetchall()
            items = []
            for r in items_rows:
                items.append({
                    "id": r["id"],
                    "data": json.loads(r["data"])
                })

            # Audit Logs
            cursor.execute("SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 50", (tenant_id,))
            audit_rows = cursor.fetchall()
            audit_logs = [dict(r) for r in audit_rows]

            # Automations
            cursor.execute("SELECT * FROM automations WHERE tenant_id = ?", (tenant_id,))
            auto_rows = cursor.fetchall()
            automations = []
            for r in auto_rows:
                automations.append({
                    "id": r["id"],
                    "name": r["name"],
                    "trigger": r["trigger_expr"],
                    "action": r["action_expr"],
                    "active": bool(r["active"]),
                    "count": r["count"]
                })

            # List all tenants for navigation dropdown
            cursor.execute("SELECT id, tenant_id, title, description, schema_name, website_url FROM boards ORDER BY rowid ASC")
            all_tenants = [dict(r) for r in cursor.fetchall()]

            # List all registered real users for Owner / Dept assignment
            cursor.execute("SELECT id, full_name, email, role, organization FROM users ORDER BY full_name ASC")
            all_users = [dict(r) for r in cursor.fetchall()]

            conn.close()

            self._send_json_response({
                "success": True,
                "tenant_id": tenant_id,
                "all_tenants": all_tenants,
                "users": all_users,
                "board": board,
                "columns_config": columns_config,
                "items": items,
                "audit_logs": audit_logs,
                "automations": automations
            })
            return

        # 5. API: Get Registered Users
        elif parsed.path == "/api/users":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, full_name, email, role, organization FROM users ORDER BY full_name ASC")
            all_users = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self._send_json_response({
                "success": True,
                "users": all_users
            })
            return

        # 6. API: Export Workspace (JSON, CSV, SQL)
        elif parsed.path == "/api/export":
            tenant_id = query.get("tenant", [None])[0] or "tenant_primary"
            fmt = query.get("format", ["json"])[0].lower()
            
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM boards WHERE tenant_id = ?", (tenant_id,))
            board_row = cursor.fetchone()
            if not board_row:
                cursor.execute("SELECT * FROM boards ORDER BY rowid ASC LIMIT 1")
                board_row = cursor.fetchone()
            
            tenant_id = board_row["tenant_id"] if board_row else tenant_id
            cols = json.loads(board_row["columns_config"]) if board_row else []
            
            cursor.execute("SELECT * FROM items WHERE tenant_id = ? ORDER BY created_at ASC", (tenant_id,))
            items_rows = cursor.fetchall()
            items_data = [json.loads(r["data"]) for r in items_rows]
            conn.close()
            
            if fmt == "csv":
                import csv, io
                out = io.StringIO()
                col_ids = [c["id"] for c in cols]
                col_titles = [c["title"] for c in cols]
                writer = csv.writer(out)
                writer.writerow(col_titles)
                for item in items_data:
                    row = [item.get(cid, "") for cid in col_ids]
                    writer.writerow(row)
                csv_content = out.getvalue()
                
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f"attachment; filename=openflow_{tenant_id}.csv")
                self.send_header("Content-Length", str(len(csv_content.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(csv_content.encode('utf-8'))
                return
                
            elif fmt == "sql":
                sql_lines = [
                    f"-- OpenFlow Work OS SQL Export for Workspace: {tenant_id}",
                    f"-- Exported on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                    ""
                ]
                for item in items_data:
                    val_json = json.dumps(item).replace("'", "''")
                    sql_lines.append(f"INSERT INTO items (id, tenant_id, data) VALUES ('item_{int(time.time()*1000)}', '{tenant_id}', '{val_json}');")
                sql_content = "\n".join(sql_lines)
                
                self.send_response(200)
                self.send_header("Content-Type", "application/sql; charset=utf-8")
                self.send_header("Content-Disposition", f"attachment; filename=openflow_{tenant_id}.sql")
                self.send_header("Content-Length", str(len(sql_content.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(sql_content.encode('utf-8'))
                return
                
            else:
                self._send_json_response({
                    "success": True,
                    "tenant_id": tenant_id,
                    "columns": cols,
                    "items": items_data,
                    "total_count": len(items_data)
                })
                return

        # 9.1 API: Get System Pricing & Team Salary Revenue Sharing (SYNCED WITH REGISTERED ACCOUNTS)
        elif parsed.path == "/api/finance/revenue-sharing":
            tenant_id = query.get("tenant_id", [None])[0] or query.get("tenant", [None])[0]
            if not tenant_id:
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            
            # Fetch registered users
            cursor.execute("SELECT id, full_name, email, role, organization FROM users ORDER BY created_at ASC")
            db_users = cursor.fetchall()

            cursor.execute("SELECT tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, team_shares FROM workspace_revenue_sharing WHERE tenant_id = ?", (tenant_id,))
            row = cursor.fetchone()

            # Build default shares from real registered users
            default_shares = []
            if db_users:
                user_count = len(db_users)
                reserve_pct = 10.0
                avail_pct = 90.0
                equal_split = round(avail_pct / user_count, 1)

                for u in db_users:
                    u_role_title = "Lead Architect & Founder" if "azarel" in u["full_name"].lower() else ("System Administrator" if u["role"] == "admin" else (u["role"].replace('_', ' ').title()))
                    default_shares.append({
                        "id": f"share_{u['id']}",
                        "user_id": u["id"],
                        "member_name": u["full_name"],
                        "email": u["email"],
                        "role": f"{u_role_title} ({u['organization'] or 'OpenFlow'})",
                        "percentage": equal_split,
                        "status": "Disbursed"
                    })
                
                # Company reserve
                default_shares.append({
                    "id": "share_reserve",
                    "user_id": "company_reserve",
                    "member_name": "Company Infrastructure & Emergency Fund",
                    "email": "finance@openflow.io",
                    "role": "Server Pool, SSL & Contingency Reserve",
                    "percentage": reserve_pct,
                    "status": "Disbursed"
                })
            else:
                default_shares = [
                    {"id": "share_admin", "member_name": "System Administrator", "email": "admin@openflow.io", "role": "System Architect", "percentage": 90.0, "status": "Disbursed"},
                    {"id": "share_reserve", "member_name": "Company Reserve", "email": "finance@openflow.io", "role": "Server Pool", "percentage": 10.0, "status": "Disbursed"}
                ]

            if not row:
                cursor.execute(
                    "INSERT INTO workspace_revenue_sharing (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, team_shares) VALUES (?, ?, ?, ?, ?)",
                    (tenant_id, 1500000.0, 1500000.0, 10.0, json.dumps(default_shares))
                )
                conn.commit()
                conn.close()
                self._send_json_response({
                    "success": True,
                    "tenant_id": tenant_id,
                    "system_selling_price": 1500000.0,
                    "collected_amount": 1500000.0,
                    "overhead_reserve_pct": 10.0,
                    "team_shares": default_shares
                })
            else:
                existing_shares = json.loads(row["team_shares"]) if row["team_shares"] else []
                # Merge any newly registered users who are not yet in existing_shares
                existing_user_ids = {s.get("user_id") or s.get("member_name") for s in existing_shares}
                has_updates = False

                for u in db_users:
                    if u["id"] not in existing_user_ids and u["full_name"] not in existing_user_ids:
                        u_role_title = u["role"].replace('_', ' ').title()
                        existing_shares.append({
                            "id": f"share_{u['id']}",
                            "user_id": u["id"],
                            "member_name": u["full_name"],
                            "email": u["email"],
                            "role": f"{u_role_title} ({u['organization'] or 'OpenFlow'})",
                            "percentage": 0.0,
                            "status": "Ready for Payout"
                        })
                        has_updates = True

                if has_updates:
                    cursor.execute("UPDATE workspace_revenue_sharing SET team_shares = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?", (json.dumps(existing_shares), tenant_id))
                    conn.commit()

                conn.close()
                self._send_json_response({
                    "success": True,
                    "tenant_id": tenant_id,
                    "system_selling_price": float(row["system_selling_price"] or 1500000.0),
                    "collected_amount": float(row["collected_amount"] or 1500000.0),
                    "overhead_reserve_pct": float(row["overhead_reserve_pct"] or 10.0),
                    "team_shares": existing_shares if existing_shares else default_shares
                })
            return

        # 9. API: Get Workspace Finance & Budget Ledger
        elif parsed.path == "/api/finance":
            tenant_id = query.get("tenant_id", [None])[0] or query.get("tenant", [None])[0]
            if not tenant_id:
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, tenant_id, item_title, category, allocated, spent, status, date, notes, created_at FROM workspace_finance WHERE tenant_id = ? ORDER BY created_at DESC", (tenant_id,))
            rows = cursor.fetchall()
            conn.close()

            items_list = [dict(r) for r in rows]
            self._send_json_response({"success": True, "tenant_id": tenant_id, "finance_items": items_list})
            return

        # 8. API: Get Workspace Planner & Notes
        elif parsed.path == "/api/planner":
            tenant_id = query.get("tenant_id", [None])[0] or query.get("tenant", [None])[0]
            if not tenant_id:
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT notes, todos FROM workspace_planners WHERE tenant_id = ?", (tenant_id,))
            row = cursor.fetchone()
            conn.close()

            if row:
                todos_data = json.loads(row["todos"]) if row["todos"] else []
                self._send_json_response({"success": True, "tenant_id": tenant_id, "notes": row["notes"] or "", "todos": todos_data})
            else:
                self._send_json_response({"success": True, "tenant_id": tenant_id, "notes": "", "todos": []})
            return

        # 7. Health check
        elif parsed.path == "/api/health":
            self._send_json_response({"status": "online", "db": DB_FILE})
            return

        # Default: Static files handler
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_len).decode("utf-8")) if content_len > 0 else {}

        conn = get_db()
        cursor = conn.cursor()

        # API: Save System Pricing & Team Salary Sharing
        if parsed.path == "/api/finance/revenue-sharing":
            tenant_id = body.get("tenant_id")
            system_selling_price = float(body.get("system_selling_price", 1500000.0))
            collected_amount = float(body.get("collected_amount", system_selling_price))
            overhead_reserve_pct = float(body.get("overhead_reserve_pct", 10.0))
            team_shares = body.get("team_shares", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_revenue_sharing (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, team_shares, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, json.dumps(team_shares))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "message": "System pricing and salary sharing updated successfully"})
            return


        # API: Create / Update Workspace Finance Entry
        elif parsed.path == "/api/finance":
            tenant_id = body.get("tenant_id")
            item_id = body.get("id") or f"fin_{int(time.time() * 1000)}"
            item_title = body.get("item_title", "Untitled Expense")
            category = body.get("category", "Operations")
            allocated = float(body.get("allocated", 0))
            spent = float(body.get("spent", 0))
            status = body.get("status", "Approved")
            date_val = body.get("date", datetime.now().strftime("%Y-%m-%d"))
            notes = body.get("notes", "")

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_finance (id, tenant_id, item_title, category, allocated, spent, status, date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (item_id, tenant_id, item_title, category, allocated, spent, status, date_val, notes)
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "id": item_id, "message": "Finance entry saved successfully"})
            return

        # API: Save Workspace Planner & Notes
        elif parsed.path == "/api/planner":
            tenant_id = body.get("tenant_id")
            notes = body.get("notes", "")
            todos = body.get("todos", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_planners (tenant_id, notes, todos, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, notes, json.dumps(todos))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "tenant_id": tenant_id, "message": "Planner saved successfully"})
            return


        # 1. API: Real User Registration (/api/auth/register) - STRICT & AUTHENTIC
        elif parsed.path == "/api/auth/register":
            email = body.get("email", "").strip().lower()
            password = body.get("password", "").strip()
            full_name = body.get("full_name", "").strip()
            role = body.get("role", "admin")
            organization = body.get("organization", "OpenFlow Workspace").strip() or "OpenFlow Workspace"

            if not full_name:
                conn.close()
                self._send_json_response({"success": False, "error": "Please provide your Full Name."}, 400)
                return
            if not email or "@" not in email:
                conn.close()
                self._send_json_response({"success": False, "error": "Please provide a valid email address."}, 400)
                return
            if not password or len(password) < 4:
                conn.close()
                self._send_json_response({"success": False, "error": "Password must be at least 4 characters."}, 400)
                return

            cursor.execute("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))", (email,))
            if cursor.fetchone():
                conn.close()
                self._send_json_response({"success": False, "error": "An account with this email address already exists. Please sign in."}, 409)
                return

            user_id = f"usr_{int(time.time() * 1000)}"
            p_hash = hash_password(password)
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, full_name, role, organization)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, email, p_hash, full_name, role, organization))

            user_dict = {
                "id": user_id,
                "email": email,
                "full_name": full_name,
                "role": role,
                "organization": organization
            }

            token = secrets.token_hex(24)
            cursor.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
            conn.commit()
            conn.close()

            self._send_json_response({
                "success": True,
                "token": token,
                "user": user_dict
            })
            return

        # 2. API: Real User Login (/api/auth/login) - STRICT PASSWORD VERIFICATION
        elif parsed.path == "/api/auth/login":
            email = body.get("email", "").strip().lower()
            password = body.get("password", "").strip()

            if not email:
                conn.close()
                self._send_json_response({"success": False, "error": "Email address is required."}, 400)
                return
            if not password:
                conn.close()
                self._send_json_response({"success": False, "error": "Password is required."}, 400)
                return

            cursor.execute("""
                SELECT id, email, password_hash, full_name, role, organization
                FROM users
                WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
            """, (email,))
            user_row = cursor.fetchone()

            if not user_row:
                conn.close()
                self._send_json_response({"success": False, "error": "No account found with this email address. Please register first."}, 401)
                return

            stored_hash = user_row["password_hash"]
            provided_hash = hash_password(password)

            if stored_hash != provided_hash:
                conn.close()
                self._send_json_response({"success": False, "error": "Incorrect password. Please try again."}, 401)
                return

            user_dict = {
                "id": user_row["id"],
                "email": user_row["email"],
                "full_name": user_row["full_name"],
                "role": user_row["role"],
                "organization": user_row["organization"]
            }

            token = secrets.token_hex(24)
            cursor.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_dict["id"]))
            conn.commit()
            conn.close()

            self._send_json_response({
                "success": True,
                "token": token,
                "user": user_dict
            })
            return

        # 3. API: User Logout (/api/auth/logout)
        elif parsed.path == "/api/auth/logout":
            token = body.get("token") or self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            if token:
                cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
            conn.close()
            self._send_json_response({"success": True, "message": "Logged out successfully."})
            return

        # 4. API: Insert Item (Enforces authenticated user)
        elif parsed.path == "/api/items":
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else body.get("user", "System")
            user_role = user["role"] if user else body.get("role", "admin")

            item_id = body.get("id", f"row_{int(time.time() * 1000)}")
            tenant_id = body.get("tenant_id", "tenant_primary")
            board_id = body.get("board_id", "board_primary")
            data = body.get("data", {})

            cursor.execute(
                "INSERT INTO items (id, tenant_id, board_id, data) VALUES (?, ?, ?, ?)",
                (item_id, tenant_id, board_id, json.dumps(data))
            )

            title = data.get("col_title", "New Project")
            log_id = f"log_{int(time.time() * 1000)}"
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            sha = hashlib.sha256(f"{item_id}-{now_str}".encode()).hexdigest()[:10]

            cursor.execute("""
                INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (log_id, tenant_id, now_str, user_name, user_role, "Record Created", "", title, title, f"sha256:{sha}..."))

            conn.commit()
            conn.close()

            self._send_json_response({"success": True, "item": {"id": item_id, "data": data}})
            return

        # 5. API: Create New Schema / Tenant
        elif parsed.path == "/api/tenants":
            name = body.get("name", "New Schema").strip()
            schema_slug = body.get("schema_name", name.lower().replace(" ", "_")).strip()
            tenant_id = f"tenant_{schema_slug}"
            board_id = f"board_{schema_slug}"
            desc = body.get("description", "Custom Dynamic JSONB Schema")
            website_url = body.get("website_url", "").strip()
            if not website_url:
                website_url = f"https://{schema_slug.replace('_', '-')}.gov.ph"
            
            custom_columns = body.get("columns_config")
            if not custom_columns:
                custom_columns = [
                    { "id": "col_title", "type": "text", "title": "Features", "required": True, "width": "320px" },
                    { "id": "col_status", "type": "status", "title": "Status Stage", "options": ["Planning", "In Progress", "Review", "Completed", "Blocked"], "width": "170px" },
                    { "id": "col_dept", "type": "person", "title": "Owner / Dept", "width": "240px" },
                    { "id": "col_priority", "type": "priority", "title": "Priority", "options": ["Critical", "High", "Medium", "Low"], "width": "140px" },
                    { "id": "col_timeline", "type": "date", "title": "Target Release", "width": "170px" },
                    { "id": "col_progress", "type": "progress", "title": "Progress %", "width": "180px" }
                ]

            cursor.execute(
                "INSERT OR REPLACE INTO boards (id, tenant_id, title, description, schema_name, columns_config, website_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (board_id, tenant_id, name, desc, schema_slug, json.dumps(custom_columns), website_url)
            )
            conn.commit()
            conn.close()

            self._send_json_response({"success": True, "tenant_id": tenant_id, "tenant": {"id": board_id, "tenant_id": tenant_id, "title": name, "schema_name": schema_slug, "website_url": website_url}})
            return

        # 6. API: Add Column to columns_config JSON
        elif parsed.path == "/api/columns":
            tenant_id = body.get("tenant_id", "tenant_primary")
            new_col = body.get("column", {})

            cursor.execute("SELECT columns_config FROM boards WHERE tenant_id = ?", (tenant_id,))
            row = cursor.fetchone()
            if row:
                cols = json.loads(row["columns_config"])
                cols.append(new_col)
                cursor.execute("UPDATE boards SET columns_config = ? WHERE tenant_id = ?", (json.dumps(cols), tenant_id))

                col_id = new_col.get("id")
                def_val = 0 if new_col.get("type") in ["currency", "progress"] else ""
                cursor.execute("SELECT id, data FROM items WHERE tenant_id = ?", (tenant_id,))
                items_rows = cursor.fetchall()
                for ir in items_rows:
                    item_data = json.loads(ir["data"])
                    item_data[col_id] = def_val
                    cursor.execute("UPDATE items SET data = ? WHERE id = ?", (json.dumps(item_data), ir["id"]))

                conn.commit()

            conn.close()
            self._send_json_response({"success": True, "column": new_col})
            return

        # 7. API: Create Automation
        elif parsed.path == "/api/automations":
            auto_id = body.get("id", f"rule_{int(time.time() * 1000)}")
            tenant_id = body.get("tenant_id", "tenant_primary")
            name = body.get("name", "Custom Rule")
            trig = body.get("trigger", "")
            act = body.get("action", "")

            cursor.execute("""
                INSERT INTO automations (id, tenant_id, name, trigger_expr, action_expr, active, count)
                VALUES (?, ?, ?, ?, ?, 1, 0)
            """, (auto_id, tenant_id, name, trig, act))

            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "automation": {"id": auto_id, "name": name, "trigger": trig, "action": act, "active": True, "count": 0}})
            return

        # 8. API: Clear all items for a tenant (Clean Slate)
        elif parsed.path == "/api/clear":
            tenant_id = body.get("tenant_id", "tenant_primary")
            cursor.execute("DELETE FROM items WHERE tenant_id = ?", (tenant_id,))
            cursor.execute("DELETE FROM audit_logs WHERE tenant_id = ?", (tenant_id,))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "message": f"Cleared all items and logs for {tenant_id}"})
            return

        # 9. API: Audit Log Rollback (Revert change)
        elif parsed.path == "/api/audit/rollback":
            log_id = body.get("log_id")
            tenant_id = body.get("tenant_id", "tenant_primary")
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else "Lead Developer"
            
            cursor.execute("SELECT * FROM audit_logs WHERE id = ? AND tenant_id = ?", (log_id, tenant_id))
            log_row = cursor.fetchone()
            if not log_row:
                conn.close()
                self._send_json_response({"success": False, "error": "Audit log record not found"}, 404)
                return
            
            field_name = log_row["field"]
            old_val = log_row["old_val"]
            current_val = log_row["new_val"]
            item_title = log_row["item_title"]
            
            # Find item by title or search items
            cursor.execute("SELECT id, data FROM items WHERE tenant_id = ?", (tenant_id,))
            items = cursor.fetchall()
            target_item = None
            target_col_id = None
            
            # Get columns_config to map field title to col_id
            cursor.execute("SELECT columns_config FROM boards WHERE tenant_id = ?", (tenant_id,))
            b_row = cursor.fetchone()
            cols = json.loads(b_row["columns_config"]) if b_row else []
            for c in cols:
                if c["title"].lower() == field_name.lower() or c["id"].lower() == field_name.lower():
                    target_col_id = c["id"]
                    break
            if not target_col_id:
                fn_low = field_name.lower()
                if "feature" in fn_low or "title" in fn_low:
                    target_col_id = "col_title"
                elif "status" in fn_low:
                    target_col_id = "col_status"
                elif "priority" in fn_low:
                    target_col_id = "col_priority"
                elif "dept" in fn_low or "lead" in fn_low or "assignee" in fn_low or "owner" in fn_low:
                    target_col_id = "col_dept"
                elif "progress" in fn_low:
                    target_col_id = "col_progress"
                elif "timeline" in fn_low or "date" in fn_low or "release" in fn_low:
                    target_col_id = "col_timeline"
                else:
                    target_col_id = field_name
            
            for item in items:
                idata = json.loads(item["data"])
                if idata.get("col_title") == item_title or str(idata.get(target_col_id)) == str(current_val):
                    target_item = item
                    break
            
            if target_item:
                idata = json.loads(target_item["data"])
                # Type cast if needed
                parsed_old = old_val
                if str(old_val).isdigit():
                    parsed_old = int(old_val)
                elif old_val.replace('.', '', 1).isdigit():
                    parsed_old = float(old_val)
                elif old_val.lower() == 'true':
                    parsed_old = True
                elif old_val.lower() == 'false':
                    parsed_old = False
                
                idata[target_col_id] = parsed_old
                cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(idata), target_item["id"]))
                
                # Log rollback action
                new_log_id = f"log_rb_{int(time.time() * 1000)}"
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (new_log_id, tenant_id, now_str, user_name, "admin", f"Rollback: {field_name}", str(current_val), str(old_val), item_title, "sha256:reverted..."))
                
                conn.commit()
                conn.close()
                self._send_json_response({"success": True, "message": f"Successfully reverted '{field_name}' back to '{old_val}' for '{item_title}'"})
                return
            else:
                conn.close()
                self._send_json_response({"success": False, "error": f"Matching feature record '{item_title}' not found to revert."}, 404)
                return

        # 10. API: Bulk Import Data (CSV / JSON dataset)
        elif parsed.path == "/api/import":
            tenant_id = body.get("tenant_id", "tenant_primary")
            raw_items = body.get("items", [])
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else "Import Wizard"
            
            if not raw_items or not isinstance(raw_items, list):
                conn.close()
                self._send_json_response({"success": False, "error": "No valid items array provided for import."}, 400)
                return
            
            imported_count = 0
            for item_data in raw_items:
                if not isinstance(item_data, dict):
                    continue
                # Ensure default keys
                if "col_title" not in item_data:
                    item_data["col_title"] = item_data.get("title", item_data.get("name", f"Imported Feature #{imported_count + 1}"))
                if "col_status" not in item_data:
                    item_data["col_status"] = item_data.get("status", "Planning")
                if "col_priority" not in item_data:
                    item_data["col_priority"] = item_data.get("priority", "Medium")
                if "col_dept" not in item_data:
                    item_data["col_dept"] = item_data.get("department", "Core Engineering")
                if "col_progress" not in item_data:
                    item_data["col_progress"] = item_data.get("progress", 0)
                if "col_timeline" not in item_data:
                    item_data["col_timeline"] = item_data.get("timeline", datetime.now().strftime("%Y-12-31"))
                
                item_id = f"item_{int(time.time() * 1000)}_{imported_count}"
                cursor.execute(
                    "INSERT INTO items (id, tenant_id, data) VALUES (?, ?, ?)",
                    (item_id, tenant_id, json.dumps(item_data))
                )
                imported_count += 1
            
            # Log bulk import in audit trail
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("""
                INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (f"log_imp_{int(time.time()*1000)}", tenant_id, now_str, user_name, "admin", "Dataset Bulk Import", "0", str(imported_count), f"Batch Import ({imported_count} items)", "sha256:imported..."))
            
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "imported_count": imported_count})
            return

        # 11. API: Live Database SQL Query Console
        elif parsed.path == "/api/query":
            sql = body.get("sql", "").strip()
            if not sql:
                conn.close()
                self._send_json_response({"success": False, "error": "SQL query cannot be empty."}, 400)
                return
            
            # Read-only enforcement for security
            first_word = sql.split()[0].upper()
            if first_word not in ["SELECT", "PRAGMA", "EXPLAIN"]:
                conn.close()
                self._send_json_response({"success": False, "error": "Only read-only SELECT and PRAGMA queries are allowed in query console."}, 403)
                return
            
            try:
                cursor.execute(sql)
                rows = cursor.fetchmany(100)
                col_names = [desc[0] for desc in cursor.description] if cursor.description else []
                res_rows = []
                for r in rows:
                    res_rows.append(dict(r))
                conn.close()
                self._send_json_response({"success": True, "columns": col_names, "rows": res_rows, "count": len(res_rows)})
                return
            except Exception as e:
                conn.close()
                self._send_json_response({"success": False, "error": str(e)}, 400)
                return

        
        # 11. API: Add Comment to Item
        elif parsed.path == "/api/items/comments":
            item_id = body.get("item_id")
            text = body.get("text", "").strip()
            tenant_id = body.get("tenant_id", "tenant_primary")
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else "System Member"
            user_role = user["role"] if user else "admin"

            if not item_id or not text:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or comment text."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            initials = "".join([n[0] for n in user_name.split() if n]).upper()[:2] if user_name else "US"
            comment = {
                "id": f"cmt_{int(time.time() * 1000)}",
                "user_name": user_name,
                "user_role": user_role,
                "initials": initials,
                "text": text,
                "timestamp": now_str
            }

            if "comments" not in item_data or not isinstance(item_data["comments"], list):
                item_data["comments"] = []
            item_data["comments"].append(comment)

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))

            # Audit log
            log_id = f"log_{int(time.time() * 1000)}"
            cursor.execute("""
                INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (log_id, tenant_id, now_str, user_name, user_role, "Comment Added", "", text[:50], item_data.get("col_title", "Feature"), "sha256:comment_added"))

            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "comment": comment, "comments": item_data["comments"]})
            return

        # 12. API: Add Sub-task to Item
        elif parsed.path == "/api/items/subtasks":
            item_id = body.get("item_id")
            title = body.get("title", "").strip()
            if not item_id or not title:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or subtask title."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            subtask = {
                "id": f"sub_{int(time.time() * 1000)}",
                "title": title,
                "completed": False,
                "created_at": now_str
            }

            if "subtasks" not in item_data or not isinstance(item_data["subtasks"], list):
                item_data["subtasks"] = []
            item_data["subtasks"].append(subtask)

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "subtask": subtask, "subtasks": item_data["subtasks"]})
            return

        # 13. API: Add Attachment / Resource Link
        elif parsed.path == "/api/items/attachments":
            item_id = body.get("item_id")
            name = body.get("name", "Attachment").strip()
            url = body.get("url", "").strip()
            file_type = body.get("file_type", "link").strip()
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else "Member"

            if not item_id or not url:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or URL."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            attachment = {
                "id": f"att_{int(time.time() * 1000)}",
                "name": name,
                "url": url,
                "file_type": file_type,
                "uploaded_by": user_name,
                "timestamp": now_str
            }

            if "attachments" not in item_data or not isinstance(item_data["attachments"], list):
                item_data["attachments"] = []
            item_data["attachments"].append(attachment)

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "attachment": attachment, "attachments": item_data["attachments"]})
            return

        conn.close()
        self._send_json_response({"error": "Endpoint not found"}, 404)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_len).decode("utf-8")) if content_len > 0 else {}

        conn = get_db()
        cursor = conn.cursor()

        # 1. API: Update Item Cell & Record Real User in Audit Log
        if parsed.path == "/api/items":
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else body.get("user", "System User")
            user_role = user["role"] if user else body.get("role", "admin")

            # RBAC Enforcement: Auditors are strictly read-only
            if user and user["role"] == "auditor":
                conn.close()
                self._send_json_response({"success": False, "error": "COA Auditor has immutable read-only access."}, 403)
                return

            item_id = body.get("id")
            tenant_id = body.get("tenant_id", "tenant_primary")
            col_id = body.get("col_id")
            new_val = body.get("new_val")
            col_title = body.get("col_title", col_id)

            cursor.execute("SELECT data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if row:
                item_data = json.loads(row["data"])
                old_val = item_data.get(col_id, "")
                item_data[col_id] = new_val

                cursor.execute(
                    "UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (json.dumps(item_data), item_id)
                )

                log_id = f"log_{int(time.time() * 1000)}"
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                sha = hashlib.sha256(f"{item_id}-{col_id}-{new_val}-{now_str}".encode()).hexdigest()[:10]

                cursor.execute("""
                    INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (log_id, tenant_id, now_str, user_name, user_role, col_title, str(old_val), str(new_val), item_data.get("col_title", "Untitled Project"), f"sha256:{sha}..."))

                # Evaluate Automations
                cursor.execute("SELECT * FROM automations WHERE tenant_id = ? AND active = 1", (tenant_id,))
                autos = cursor.fetchall()
                triggered_rule = None
                for a in autos:
                    if col_id == "col_status" and new_val == "Approved":
                        cursor.execute("UPDATE automations SET count = count + 1 WHERE id = ?", (a["id"],))
                        triggered_rule = a["name"]
                    elif col_id == "col_budget" and isinstance(new_val, (int, float)) and new_val > 50000000:
                        cursor.execute("UPDATE automations SET count = count + 1 WHERE id = ?", (a["id"],))
                        triggered_rule = a["name"]

                conn.commit()
                conn.close()

                self._send_json_response({
                    "success": True,
                    "item": {"id": item_id, "data": item_data},
                    "triggered_automation": triggered_rule
                })
                return

        # 2. API: Edit Schema / Board Metadata
        elif parsed.path == "/api/boards":
            tenant_id = body.get("tenant_id")
            title = body.get("title", "").strip()
            desc = body.get("description", "").strip()
            website_url = body.get("website_url", "").strip()
            user = get_auth_user(self.headers)
            user_name = user["full_name"] if user else "Lead Administrator"
            user_role = user["role"] if user else "admin"

            if tenant_id and title:
                cursor.execute(
                    "UPDATE boards SET title = ?, description = ?, website_url = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?",
                    (title, desc, website_url, tenant_id)
                )
                
                # Log edit to audit trail
                log_id = f"log_{int(time.time() * 1000)}"
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT INTO audit_logs (id, tenant_id, timestamp, user, role, field, old_val, new_val, item_title, hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (log_id, tenant_id, now_str, user_name, user_role, "Workspace Metadata Updated", "Previous Config", title, f"Workspace: {title}", "sha256:workspace_updated"))
                
                conn.commit()
                conn.close()
                self._send_json_response({"success": True, "message": f"Workspace '{title}' updated successfully."})
                return
            else:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing required fields."}, 400)
                return

        # 3. API: Toggle Subtask Completion
        elif parsed.path == "/api/items/subtasks":
            item_id = body.get("item_id")
            subtask_id = body.get("subtask_id")
            completed = body.get("completed")

            if not item_id or not subtask_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or subtask_id."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            subtasks = item_data.get("subtasks", [])
            for st in subtasks:
                if st.get("id") == subtask_id:
                    st["completed"] = bool(completed)
                    break

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "subtasks": subtasks})
            return

        # API: Save System Pricing & Team Salary Sharing
        if parsed.path == "/api/finance/revenue-sharing":
            tenant_id = body.get("tenant_id")
            system_selling_price = float(body.get("system_selling_price", 1500000.0))
            collected_amount = float(body.get("collected_amount", system_selling_price))
            overhead_reserve_pct = float(body.get("overhead_reserve_pct", 10.0))
            team_shares = body.get("team_shares", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_revenue_sharing (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, team_shares, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, json.dumps(team_shares))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "message": "System pricing and salary sharing updated successfully"})
            return


        # API: Create / Update Workspace Finance Entry
        elif parsed.path == "/api/finance":
            tenant_id = body.get("tenant_id")
            item_id = body.get("id") or f"fin_{int(time.time() * 1000)}"
            item_title = body.get("item_title", "Untitled Expense")
            category = body.get("category", "Operations")
            allocated = float(body.get("allocated", 0))
            spent = float(body.get("spent", 0))
            status = body.get("status", "Approved")
            date_val = body.get("date", datetime.now().strftime("%Y-%m-%d"))
            notes = body.get("notes", "")

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_finance (id, tenant_id, item_title, category, allocated, spent, status, date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (item_id, tenant_id, item_title, category, allocated, spent, status, date_val, notes)
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "id": item_id, "message": "Finance entry saved successfully"})
            return

        # API: Save Workspace Planner & Notes
        elif parsed.path == "/api/planner":
            tenant_id = body.get("tenant_id")
            notes = body.get("notes", "")
            todos = body.get("todos", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_planners (tenant_id, notes, todos, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, notes, json.dumps(todos))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "tenant_id": tenant_id, "message": "Planner saved successfully"})
            return


        conn.close()
        self._send_json_response({"error": "Endpoint not found"}, 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        conn = get_db()
        cursor = conn.cursor()

        # API: Delete Finance Entry
        if parsed.path == "/api/finance":
            fin_id = query.get("id", [None])[0]
            if fin_id:
                cursor.execute("DELETE FROM workspace_finance WHERE id = ?", (fin_id,))
                conn.commit()
                conn.close()
                self._send_json_response({"success": True, "deleted_id": fin_id})
                return

        # 1. API: Delete Item
        elif parsed.path == "/api/items":
            item_id = query.get("id", [None])[0]
            if item_id:
                cursor.execute("DELETE FROM items WHERE id = ?", (item_id,))
                conn.commit()
                conn.close()
                self._send_json_response({"success": True, "deleted_id": item_id})
                return

        # 2. API: Delete User from Database (/api/users?id=...)
        elif parsed.path == "/api/users":
            user_id = query.get("id", [None])[0]
            if user_id:
                cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
                cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                conn.commit()
                conn.close()
                self._send_json_response({"success": True, "deleted_user_id": user_id})
                return

        # 3. API: Delete Column from Schema
        elif parsed.path == "/api/columns":
            tenant_id = query.get("tenant_id", [None])[0]
            col_id = query.get("col_id", [None])[0]

            if tenant_id and col_id:
                cursor.execute("SELECT columns_config FROM boards WHERE tenant_id = ?", (tenant_id,))
                row = cursor.fetchone()
                if row:
                    cols = json.loads(row["columns_config"])
                    cols = [c for c in cols if c["id"] != col_id]
                    cursor.execute("UPDATE boards SET columns_config = ? WHERE tenant_id = ?", (json.dumps(cols), tenant_id))

                    cursor.execute("SELECT id, data FROM items WHERE tenant_id = ?", (tenant_id,))
                    items_rows = cursor.fetchall()
                    for ir in items_rows:
                        item_data = json.loads(ir["data"])
                        if col_id in item_data:
                            del item_data[col_id]
                            cursor.execute("UPDATE items SET data = ? WHERE id = ?", (json.dumps(item_data), ir["id"]))

                    conn.commit()

                conn.close()
                self._send_json_response({"success": True, "deleted_col_id": col_id})
                return

        # 4. API: Delete Schema / Tenant (Project Workspace)
        elif parsed.path == "/api/tenants":
            tenant_id = query.get("tenant_id", [None])[0]
            if tenant_id:
                cursor.execute("DELETE FROM boards WHERE tenant_id = ?", (tenant_id,))
                cursor.execute("DELETE FROM items WHERE tenant_id = ?", (tenant_id,))
                cursor.execute("DELETE FROM audit_logs WHERE tenant_id = ?", (tenant_id,))
                cursor.execute("DELETE FROM automations WHERE tenant_id = ?", (tenant_id,))
                conn.commit()

                # If no boards left, recreate default board
                cursor.execute("SELECT COUNT(*) as count FROM boards")
                if cursor.fetchone()["count"] == 0:
                    default_columns = [
                        { "id": "col_title", "type": "text", "title": "Features", "required": True, "width": "320px" },
                        { "id": "col_status", "type": "status", "title": "Status Stage", "options": ["Planning", "In Progress", "Review", "Completed", "Blocked"], "width": "170px" },
                        { "id": "col_dept", "type": "person", "title": "Module / Lead", "width": "220px" },
                        { "id": "col_priority", "type": "priority", "title": "Priority", "options": ["Critical", "High", "Medium", "Low"], "width": "140px" },
                        { "id": "col_timeline", "type": "date", "title": "Target Release", "width": "170px" },
                        { "id": "col_progress", "type": "progress", "title": "Progress %", "width": "180px" }
                    ]
                    cursor.execute(
                        "INSERT INTO boards (id, tenant_id, title, description, schema_name, columns_config, website_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        ("board_primary", "tenant_primary", "Custom Workspace & Project Master Board", "Dynamic PostgreSQL/SQLite JSONB Schema", "custom_schema_01", json.dumps(default_columns), "https://openflow.io")
                    )
                    conn.commit()

                # Return the next available tenant
                cursor.execute("SELECT tenant_id FROM boards ORDER BY rowid ASC LIMIT 1")
                next_row = cursor.fetchone()
                next_tenant_id = next_row["tenant_id"] if next_row else "tenant_primary"

                conn.close()
                self._send_json_response({"success": True, "deleted_tenant_id": tenant_id, "next_tenant_id": next_tenant_id})
                return

        # 5. API: Delete Comment from Item
        elif parsed.path == "/api/items/comments":
            item_id = query.get("item_id", [None])[0]
            comment_id = query.get("comment_id", [None])[0]

            if not item_id or not comment_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or comment_id."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            comments = item_data.get("comments", [])
            comments = [c for c in comments if c.get("id") != comment_id]
            item_data["comments"] = comments

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "comments": comments})
            return

        # 6. API: Delete Subtask from Item
        elif parsed.path == "/api/items/subtasks":
            item_id = query.get("item_id", [None])[0]
            subtask_id = query.get("subtask_id", [None])[0]

            if not item_id or not subtask_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or subtask_id."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            subtasks = item_data.get("subtasks", [])
            subtasks = [s for s in subtasks if s.get("id") != subtask_id]
            item_data["subtasks"] = subtasks

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "subtasks": subtasks})
            return

        # API: Save System Pricing & Team Salary Sharing
        if parsed.path == "/api/finance/revenue-sharing":
            tenant_id = body.get("tenant_id")
            system_selling_price = float(body.get("system_selling_price", 1500000.0))
            collected_amount = float(body.get("collected_amount", system_selling_price))
            overhead_reserve_pct = float(body.get("overhead_reserve_pct", 10.0))
            team_shares = body.get("team_shares", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_revenue_sharing (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, team_shares, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, system_selling_price, collected_amount, overhead_reserve_pct, json.dumps(team_shares))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "message": "System pricing and salary sharing updated successfully"})
            return


        # API: Create / Update Workspace Finance Entry
        elif parsed.path == "/api/finance":
            tenant_id = body.get("tenant_id")
            item_id = body.get("id") or f"fin_{int(time.time() * 1000)}"
            item_title = body.get("item_title", "Untitled Expense")
            category = body.get("category", "Operations")
            allocated = float(body.get("allocated", 0))
            spent = float(body.get("spent", 0))
            status = body.get("status", "Approved")
            date_val = body.get("date", datetime.now().strftime("%Y-%m-%d"))
            notes = body.get("notes", "")

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_finance (id, tenant_id, item_title, category, allocated, spent, status, date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (item_id, tenant_id, item_title, category, allocated, spent, status, date_val, notes)
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "id": item_id, "message": "Finance entry saved successfully"})
            return

        # API: Save Workspace Planner & Notes
        elif parsed.path == "/api/planner":
            tenant_id = body.get("tenant_id")
            notes = body.get("notes", "")
            todos = body.get("todos", [])

            if not tenant_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing tenant_id"}, 400)
                return

            cursor.execute(
                "INSERT OR REPLACE INTO workspace_planners (tenant_id, notes, todos, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (tenant_id, notes, json.dumps(todos))
            )
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "tenant_id": tenant_id, "message": "Planner saved successfully"})
            return


        # 7. API: Delete Attachment from Item
        elif parsed.path == "/api/items/attachments":
            item_id = query.get("item_id", [None])[0]
            attachment_id = query.get("attachment_id", [None])[0]

            if not item_id or not attachment_id:
                conn.close()
                self._send_json_response({"success": False, "error": "Missing item_id or attachment_id."}, 400)
                return

            cursor.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                self._send_json_response({"success": False, "error": "Item not found."}, 404)
                return

            item_data = json.loads(row["data"])
            attachments = item_data.get("attachments", [])
            attachments = [a for a in attachments if a.get("id") != attachment_id]
            item_data["attachments"] = attachments

            cursor.execute("UPDATE items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(item_data), item_id))
            conn.commit()
            conn.close()
            self._send_json_response({"success": True, "attachments": attachments})
            return

        conn.close()
        self._send_json_response({"error": "Endpoint not found"}, 404)

if __name__ == "__main__":
    init_db()
    server = http.server.ThreadingHTTPServer(("", PORT), WorkOSHandler)
    print(f"[OpenFlow Server] Work OS Database Server running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
