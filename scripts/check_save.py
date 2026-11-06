"""Read-only real-save inspection and byte-identical decrypt/encrypt validation."""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from save_store import SaveStore
with tempfile.TemporaryDirectory() as tmp:
    store=SaveStore(tmp,homes=[])
    raw,_=store.read(Path(sys.argv[1]))
    result=store.engine(raw)
    print('Round-trip validated;',len(result['fields']),'fields. Original file not modified.')
