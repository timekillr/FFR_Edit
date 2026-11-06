import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from save_store import SaveStore, digest
ROOT=Path(__file__).resolve().parents[1]

class SaveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name)/'home';self.home.mkdir()
        self.save_dir=self.home/'.local/share/Steam/steamapps/compatdata/3259780/pfx/drive_c/users/steamuser/AppData/Local/FFRS/Steam/123'
        self.save_dir.mkdir(parents=True)
        self.raw=subprocess.check_output(['node',str(ROOT/'tests/fixture.cjs')])
        self.path=self.save_dir/'GameSaveData1.sav';self.path.write_bytes(self.raw)
        self.store=SaveStore(Path(self.tmp.name)/'settings',homes=[self.home],running=lambda:False)
        self.sid=next(iter(self.store.files))
    def test_discovery_and_dedup(self):
        roots=self.home/'.steam';roots.mkdir();(roots/'steam').symlink_to(self.home/'.local/share/Steam')
        self.assertEqual(len(self.store.discover()['saves']),1)
    def test_external_library(self):
        external=Path(self.tmp.name)/'external'
        target=external/'steamapps/compatdata/3259780/pfx/drive_c/users/steamuser/AppData/Local/FFRS/Steam/other'
        target.mkdir(parents=True);(target/'GameSaveData0.sav').write_bytes(self.raw)
        (self.home/'.local/share/Steam/steamapps/libraryfolders.vdf').write_text('"path" "'+str(external)+'"')
        self.assertEqual(len(self.store.discover()['saves']),2)
    def test_open_backup_commit_restore(self):
        doc=self.store.open(self.sid);first=doc['backups'][0]['id']
        self.assertEqual(len(doc['backups']),1)
        before_mode=self.path.stat().st_mode
        updated=self.store.commit(self.sid,doc['revision'],[{'path':'Player.currentMoney','v':'999999'}],[])
        self.assertEqual(next(f['value'] for f in updated['fields'] if f['path']=='Player.currentMoney'),'999999')
        self.assertEqual(self.path.stat().st_mode,before_mode)
        restored=self.store.restore(self.sid,updated['revision'],first)
        self.assertEqual(self.path.read_bytes(),self.raw)
        self.assertTrue(any(b['reason']=='before restore' for b in restored['backups']))
    def test_manual_backup(self):
        self.store.backup(self.sid);self.assertEqual(self.store.list_backups(self.sid)[0]['reason'],'manual')
    def test_stale_revision(self):
        doc=self.store.open(self.sid)
        self.store.commit(self.sid,doc['revision'],[{'path':'Player.currentMoney','v':'222'}],[])
        prior=self.path.read_bytes()
        with self.assertRaisesRegex(ValueError,'changed on disk'):
            self.store.commit(self.sid,doc['revision'],[],[])
        self.assertEqual(self.path.read_bytes(),prior)
    def test_game_running(self):
        doc=self.store.open(self.sid);self.store.running=lambda:True
        with self.assertRaisesRegex(ValueError,'Close Final'):
            self.store.commit(self.sid,doc['revision'],[],[])
        self.assertEqual(self.path.read_bytes(),self.raw)
    def test_backup_failure_aborts(self):
        doc=self.store.open(self.sid)
        with patch.object(self.store,'backup_raw',side_effect=OSError('full disk')):
            with self.assertRaises(OSError):self.store.commit(self.sid,doc['revision'],[{'path':'Player.currentMoney','v':'2'}],[])
        self.assertEqual(self.path.read_bytes(),self.raw)
    def test_bad_input_and_int64(self):
        doc=self.store.open(self.sid)
        for v in ('NaN','Infinity','1.5','999999999999'):
            with self.assertRaises(ValueError):self.store.commit(self.sid,doc['revision'],[{'path':'Player.currentMoney','v':v}],[])
        updated=self.store.commit(self.sid,doc['revision'],[{'path':'Player.Counter','v':'9223372036854775807'}],[])
        self.assertEqual(next(f['value'] for f in updated['fields'] if f['path']=='Player.Counter'),'9223372036854775807')
    def test_inventory_and_bool(self):
        doc=self.store.open(self.sid)
        updated=self.store.commit(self.sid,doc['revision'],[{'path':'Player.testFlag','v':False}],[{'type':'item','id':2,'quantity':99}])
        self.assertEqual(next(f['value'] for f in updated['fields'] if f['path']=='inventory[1].Num'),'99')
        self.assertIs(next(f['value'] for f in updated['fields'] if f['path']=='Player.testFlag'),False)
    def test_corrupted_save_and_backup(self):
        doc=self.store.open(self.sid);b=doc['backups'][0]
        path=self.store.backups/self.sid/(b['id']+'.sav');path.write_bytes(b'x'*100)
        with self.assertRaisesRegex(ValueError,'checksum'):self.store.restore(self.sid,doc['revision'],b['id'])
        self.assertEqual(self.path.read_bytes(),self.raw)
        self.path.write_bytes(self.raw[:-1]+bytes([self.raw[-1]^1]))
        damaged=self.store.open(self.sid)
        self.assertIn('checksum',damaged['parse_error'])
        self.assertEqual(damaged['fields'],[])
    def test_restore_over_truncated_current_save(self):
        doc=self.store.open(self.sid);bid=doc['backups'][0]['id']
        self.path.write_bytes(b'bad')
        damaged=self.store.open(self.sid)
        self.assertIn('parse_error',damaged)
        restored=self.store.restore(self.sid,damaged['revision'],bid)
        self.assertEqual(self.path.read_bytes(),self.raw)
        self.assertTrue(restored['fields'])
    def test_backup_path_traversal(self):
        doc=self.store.open(self.sid)
        with self.assertRaises(ValueError):self.store.restore(self.sid,doc['revision'],'../elsewhere')
    def test_symlink_rejected(self):
        self.path.unlink();self.path.symlink_to(ROOT/'package.json')
        with self.assertRaises(OSError):self.store.open(self.sid)
    def test_unknown_and_readonly_fields(self):
        doc=self.store.open(self.sid)
        for path in ('missing','inventory[0].ItemId'):
            with self.assertRaises(ValueError):self.store.commit(self.sid,doc['revision'],[{'path':path,'v':'1'}],[])
        self.assertEqual(self.path.read_bytes(),self.raw)

if __name__=='__main__':unittest.main()
