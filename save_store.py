"""Save discovery and durable, revision-checked transactions. No third-party Python modules."""
import base64
import hashlib
import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

SLOT = re.compile(r'^GameSaveData\d+(?:\.sav)?$')
MAX_SAVE = 16 * 1024 * 1024
ROOT = Path(__file__).resolve().parent

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def clean_env():
    env = os.environ.copy()
    env.pop('NODE_OPTIONS', None)
    env.pop('LD_LIBRARY_PATH', None)
    return env

def game_running():
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            cmd = (proc / 'cmdline').read_bytes().replace(b'\x00', b' ').lower()
            if b'ffrs-win64' in cmd or b'ffrs.exe' in cmd:
                return True
            env = (proc / 'environ').read_bytes().split(b'\0')
            if any(x in (b'SteamAppId=3259780', b'SteamGameId=3259780') for x in env):
                return True
        except (OSError, ProcessLookupError):
            continue
    return False

class SaveStore:
    def __init__(self, directory, homes=None, engine=None, running=game_running):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backups = self.directory / 'backups'
        self.backups.mkdir(exist_ok=True, mode=0o700)
        self.homes = [Path(h) for h in homes] if homes is not None else list({Path(p.pw_dir) for p in pwd.getpwall() if p.pw_dir.startswith('/home/')} | {Path.home()})
        self.engine_override, self.running = engine, running
        self.files = {}
        self.config_path = self.directory / 'folders.json'
        self.custom = json.loads(self.config_path.read_text()) if self.config_path.exists() else []
        self.message = ''
        self.discover()

    def engine(self, raw, action='inspect', **args):
        if self.engine_override:
            return self.engine_override(raw, action, **args)
        node = ROOT / 'bin/node'
        executable = str(node) if node.exists() else shutil.which('node')
        if not executable:
            raise ValueError('Node runtime is missing. Reinstall the complete FFR Edit release ZIP.')
        result = subprocess.run([executable, str(ROOT / 'engine/worker.cjs')], input=json.dumps({'raw': base64.b64encode(raw).decode(), 'action': action, **args}), text=True, capture_output=True, timeout=45, env=clean_env())
        try:
            reply = json.loads(result.stdout)
        except ValueError:
            raise ValueError('The save parser did not respond. Reinstall the complete release ZIP.')
        if not reply['ok']:
            raise ValueError(reply['error'])
        return reply['data']

    @staticmethod
    def steam_roots(home):
        return [home / '.local/share/Steam', home / '.steam/steam', home / '.steam/root', home / '.var/app/com.valvesoftware.Steam/.local/share/Steam', home / 'snap/steam/common/.local/share/Steam']

    def discover(self):
        self.discovery_warnings = []
        def accessible_dir(path):
            try:
                return path.is_dir()
            except OSError as error:
                self.discovery_warnings.append(f'Could not scan {path}: {error.strerror or error}')
                return False
        bases = [(Path(p), 'Custom folder') for p in self.custom]
        for home in self.homes:
            for root in self.steam_roots(home):
                if not accessible_dir(root):
                    continue
                libs = {root}
                for loc in ('steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf'):
                    try:
                        libs.update(Path(s.replace('\\\\', '\\')) for s in re.findall(r'"path"\s+"([^"]+)"', (root / loc).read_text()))
                    except OSError:
                        pass
                for lib in libs:
                    local = lib / 'steamapps/compatdata/3259780/pfx/drive_c/users'
                    # Include non-default Proton user directories.
                    try:
                        bases.extend((user / 'AppData/Local/FFRS', str(lib)) for user in local.glob('*') if accessible_dir(user))
                    except OSError as error:
                        self.discovery_warnings.append(f'Could not scan {local}: {error}')
            bases.extend((home / folder, 'Native') for folder in ('.local/share/FFRS', '.config/FFRS'))
        found = {}
        for base, source in bases:
            if not accessible_dir(base):
                continue
            for parent, dirs, files in os.walk(base, followlinks=False, onerror=lambda e: self.discovery_warnings.append(str(e))):
                if len(Path(parent).relative_to(base).parts) >= 4:
                    dirs[:] = []
                for name in files:
                    path = Path(parent).resolve() / name
                    if SLOT.fullmatch(name):
                        try:
                            if not path.is_symlink() and path.is_file():
                                found[digest(str(path).encode())] = (path, source)
                        except OSError as error:
                            self.discovery_warnings.append(f'Could not inspect {path}: {error}')
        self.files = found
        return self.state()

    def state(self):
        saves = []
        for sid, (p, source) in self.files.items():
            try:
                info = p.lstat()
                if not stat.S_ISREG(info.st_mode):
                    continue
                slot = int(re.search(r'\d+', p.name)[0])
                saves.append({'id': sid, 'name': p.name, 'slot': slot, 'label': 'Autosave' if slot == 0 else f'Slot {slot}', 'path': str(p), 'source': source, 'mtime': info.st_mtime, 'size': info.st_size})
            except OSError:
                continue
        return {'saves': sorted(saves, key=lambda s: -s['mtime']), 'running': self.running(), 'message': self.message, 'version': '0.2.0', 'discovery_warnings': self.discovery_warnings}

    def add_folder(self, folder):
        p = Path(folder).expanduser().resolve(strict=True)
        if not p.is_dir():
            raise ValueError('Choose a directory containing saves.')
        if str(p) not in self.custom:
            self.custom.append(str(p))
            self.atomic(self.config_path, json.dumps(self.custom).encode())
        return self.discover()

    def path(self, sid):
        if sid not in self.files:
            raise ValueError('Save no longer found. Scan again.')
        return self.files[sid][0]

    @staticmethod
    def read(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            info = os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 <= info.st_size <= MAX_SAVE:
                raise ValueError('Invalid save size or file type.')
            return f.read(MAX_SAVE + 1), info

    @staticmethod
    def atomic(path, raw, info=None):
        fd, tmp = tempfile.mkstemp(prefix='.ffr-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as f:
                os.fchmod(f.fileno(), stat.S_IMODE(info.st_mode) if info else 0o600)
                if info and os.geteuid() == 0:
                    os.fchown(f.fileno(), info.st_uid, info.st_gid)
                f.write(raw)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
            SaveStore.sync_dir(path.parent)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    @staticmethod
    def sync_dir(directory):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def backup_raw(self, sid, raw, reason):
        bid = uuid.uuid4().hex
        folder = self.backups / sid
        folder.mkdir(exist_ok=True, mode=0o700)
        meta = {'id': bid, 'save_id': sid, 'name': self.path(sid).name, 'created': time.time(), 'reason': reason, 'sha256': digest(raw), 'size': len(raw)}
        self.atomic(folder / (bid + '.sav'), raw)
        self.atomic(folder / (bid + '.json'), json.dumps(meta).encode())
        verified = self.check_backup(folder / (bid + '.json'), sid)
        if not verified['verified']:
            raise OSError('Backup read-back verification failed: ' + verified['error'])
        return verified

    def check_backup(self, metadata_path, sid):
        bid = metadata_path.stem
        path = self.backups / sid / (bid + '.sav')
        fallback = {'id': bid, 'save_id': sid, 'name': self.path(sid).name,
                    'created': 0, 'reason': 'Unreadable backup', 'sha256': '', 'size': 0,
                    'path': str(path), 'verified': False}
        try:
            meta = json.loads(metadata_path.read_text())
            if (not re.fullmatch('[a-f0-9]{32}', bid) or meta.get('id') != bid or meta.get('save_id') != sid
                    or not isinstance(meta.get('created'), (int, float)) or not isinstance(meta.get('size'), int)
                    or not re.fullmatch('[a-f0-9]{64}', meta.get('sha256', ''))):
                raise ValueError('Invalid backup metadata')
            fallback.update({k: meta[k] for k in ('name', 'created', 'reason', 'sha256', 'size')})
            raw, _ = self.read(path)
            if len(raw) != meta['size'] or digest(raw) != meta['sha256']:
                raise ValueError('Backup checksum mismatch')
            return {**fallback, 'verified': True}
        except (OSError, ValueError, KeyError, TypeError) as error:
            return {**fallback, 'error': str(error)}

    def list_backups(self, sid):
        self.path(sid)
        out = [self.check_backup(p, sid) for p in (self.backups / sid).glob('*.json')
               if re.fullmatch('[a-f0-9]{32}', p.stem)]
        return sorted(out, key=lambda x: -x['created'])

    def get_backups(self, sid, revision=None):
        backups = self.list_backups(sid)
        if revision is None:
            raw, _ = self.read(self.path(sid))
            revision = digest(raw)
        verified = [b for b in backups if b['verified']]
        summary = {'checked_at': time.time(), 'total': len(backups), 'verified': len(verified), 'damaged': len(backups)-len(verified),
                   'directory': str(self.backups / sid),
                   'latest_verified': max((b['created'] for b in verified), default=None),
                   'current_revision_backed_up': any(b['sha256'] == revision for b in verified)}
        return {'backups': backups, 'backup_summary': summary}

    def open(self, sid):
        raw, _ = self.read(self.path(sid))
        try:
            data = self.engine(raw)
        except ValueError as error:
            # Damaged current saves must not hide the recovery interface.
            data = {'fields': [], 'items': [], 'parse_error': str(error),
                    'warnings': ['The current save could not be decoded: ' + str(error),
                                 'Open Backups to restore a working copy. The damaged file is preserved.']}
        # Snapshot before the user starts editing; commits also back up afresh.
        existing = self.list_backups(sid)
        if not any(b['verified'] and b['sha256'] == digest(raw) for b in existing):
            self.backup_raw(sid, raw, 'opened for editing')
        return {**data, 'save_id': sid, 'revision': digest(raw), **self.get_backups(sid, digest(raw))}

    def backup(self, sid):
        raw, _ = self.read(self.path(sid))
        self.backup_raw(sid, raw, 'manual')
        return self.open(sid)

    def backup_all(self):
        for sid in self.files:
            raw, _ = self.read(self.path(sid))
            self.backup_raw(sid, raw, 'manual all slots')
        self.message = f'{len(self.files)} save slots backed up and verified on disk.'
        return self.state()

    def replace(self, sid, revision, transform, reason):
        if self.running():
            raise ValueError('Close Final Fantasy Resonance before saving or restoring.')
        path = self.path(sid)
        raw, info = self.read(path)
        if digest(raw) != revision:
            raise ValueError('This save changed on disk. Reload it before editing or restoring.')
        new = transform(raw)
        self.engine(new)  # Never replace a save that cannot be parsed/checksummed.
        self.backup_raw(sid, raw, reason)
        current, _ = self.read(path)
        if digest(current) != revision or self.running():
            raise ValueError('The save or game state changed. Reload and try again after closing the game.')
        self.atomic(path, new, info)
        self.message = 'Save written. The previous file is backed up.'
        return self.open(sid)

    def commit(self, sid, revision, edits, operations):
        return self.replace(sid, revision, lambda raw: base64.b64decode(self.engine(raw, 'edit', edits=edits, operations=operations)['raw'], validate=True), 'before edit')

    def restore(self, sid, revision, backup_id):
        if not isinstance(backup_id, str) or not re.fullmatch('[a-f0-9]{32}', backup_id):
            raise ValueError('Invalid backup ID.')
        entries = {b['id']: b for b in self.list_backups(sid)}
        if backup_id not in entries:
            raise ValueError('Backup not found for this save slot.')
        if not entries[backup_id]['verified']:
            raise ValueError(entries[backup_id].get('error', 'Backup verification failed'))
        saved, _ = self.read(self.backups / sid / (backup_id + '.sav'))
        if digest(saved) != entries[backup_id]['sha256']:
            raise ValueError('Backup checksum mismatch. The save has not been touched.')
        return self.replace(sid, revision, lambda _: saved, 'before restore')
