"""Decky v1 backend. All local and companion file operations share one lock."""
import asyncio
import os
import sys
from pathlib import Path
sys.path.insert(0, os.path.dirname(__file__))
import decky
from save_store import SaveStore
from companion_server import CompanionServer

class Plugin:
    async def _main(self):
        self.lock = asyncio.Lock()
        self.store = SaveStore(Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / 'saves')
        self.companion = CompanionServer(self, Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / 'companion')
        if self.companion.config['enabled']:
            await self.companion.start()

    async def get_state(self, refresh=False, persist=False):
        async with self.lock:
            return await asyncio.to_thread(self.store.state)

    async def execute(self, method, args):
        methods = {'discover': self.store.discover, 'open': self.store.open, 'commit': self.store.commit, 'backup': self.store.backup, 'backup_all': self.store.backup_all, 'restore': self.store.restore}
        if method not in methods or not isinstance(args, dict):
            raise ValueError('Unknown save operation.')
        async with self.lock:
            task = asyncio.create_task(asyncio.to_thread(methods[method], **args))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                await task  # Hold the lock until a file transaction finishes.
                raise

    async def add_folder(self, folder):
        # Custom filesystem access is available only through the local Decky UI.
        async with self.lock:
            return await asyncio.to_thread(self.store.add_folder, folder)

    async def companion_status(self):
        return self.companion.status()
    async def companion_enable(self, enabled):
        return await self.companion.enable(enabled)
    async def companion_pairing(self):
        return self.companion.begin_pairing()
    async def companion_revoke(self, device_id):
        return self.companion.revoke(device_id)
    async def _unload(self):
        await self.companion.close(cancel_commands=True)
