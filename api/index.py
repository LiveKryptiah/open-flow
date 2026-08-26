import sys, os
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from server import WorkOSHandler, init_db, ensure_db_ready

try:
    ensure_db_ready()
    init_db()
except Exception as e:
    print("[Vercel Cold Start Error]:", e)

class handler(WorkOSHandler):
    def do_GET(self):
        try:
            super().do_GET()
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_json_response({"success": False, "error": str(e)}, 500)

    def do_POST(self):
        try:
            super().do_POST()
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_json_response({"success": False, "error": str(e)}, 500)

    def do_DELETE(self):
        try:
            super().do_DELETE()
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_json_response({"success": False, "error": str(e)}, 500)
