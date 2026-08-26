import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import WorkOSHandler, init_db

# Initialize database on cold start
try:
    init_db()
except Exception as e:
    print("[Vercel Serverless Init Error]", e)

class handler(WorkOSHandler):
    pass
