"""Operator tools: consistent DB backups and explicit legacy-data migration."""
import argparse
import base64
import os
import sqlite3
from pathlib import Path
from backend import server
from backend.server import database


def backup_database(destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(destination, os.O_CREAT | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(f"file:{server.DB_PATH.resolve()}?mode=ro", uri=True) as source, sqlite3.connect(destination) as target:
        source.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    os.chmod(destination, 0o600)
    return destination


def migrate_legacy(username):
    with database() as db:
        user = db.execute('SELECT id FROM users WHERE username=?', (username.lower(),)).fetchone()
        if not user:
            raise ValueError('Create the owner account first')
        # No automatic first-registrant ownership of historical personal data.
        if db.execute('SELECT 1 FROM records WHERE kind LIKE ?', (user[0]+':%',)).fetchone():
            raise ValueError('Target account already contains data; migration would collide')
        return db.execute("UPDATE records SET kind=? || ':' || kind WHERE instr(kind, ':')=0", (user[0],)).rowcount


def generate_vapid_keys():
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, 'big')
    public = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    return {'VAPID_PUBLIC_KEY': encode(public), 'VAPID_PRIVATE_KEY': encode(private)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'migrate-legacy', 'generate-vapid'])
    parser.add_argument('target', nargs='?')
    args = parser.parse_args()
    if args.action == 'generate-vapid':
        for name, value in generate_vapid_keys().items():
            print(f'{name}={value}')
    elif not args.target:
        parser.error('target is required for this action')
    elif args.action == 'backup':
        print(backup_database(args.target))
    else:
        print(f'Migrated {migrate_legacy(args.target)} records')
