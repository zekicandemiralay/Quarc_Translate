import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MODEL_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".models"))
