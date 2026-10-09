"""Start the real API with disposable SQLite data for browser tests.

Usage: backend/.venv/bin/python backend/tests/serve.py --port 8021
Never reads or changes the configured application database.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8021)
    args = parser.parse_args()
    with TemporaryDirectory(prefix='capacita-browser-') as directory:
        database = Path(directory) / 'database.db'
        os.environ['DATABASE_URL'] = f'sqlite:///{database}'
        os.environ['JWT_SECRET_KEY'] = 'disposable-browser-tests-only'
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app.main import app
        from app.database import SessionLocal, engine
        from app import models
        from app.auth import get_password_hash
        from app.services import blob_storage
        from fastapi import HTTPException, Request
        import uvicorn

        # No real Vercel Blob store for disposable browser tests: an in-memory
        # dict stands in for it for the life of this one process.
        store: dict[str, bytes] = {}

        def fake_upload(pathname, data, content_type=None):
            store[pathname] = data
            return pathname

        blob_storage.upload = fake_upload
        blob_storage.download = store.get
        blob_storage.delete = lambda pathname: store.pop(pathname, None)
        blob_storage.size = lambda pathname: len(store[pathname]) if pathname in store else None
        # Attachments go from the browser straight to the Blob API. The journeys
        # redirect those requests here, so tokens are signed for a disposable store.
        os.environ['BLOB_READ_WRITE_TOKEN'] = 'vercel_blob_rw_disposable_browser-tests-only'

        @app.put('/api/fake-blob')
        async def fake_blob_put(request: Request, pathname: str):
            client_token = request.headers.get('authorization', '').removeprefix('Bearer vercel_blob_client_disposable_')
            signed = json.loads(base64.b64decode(base64.b64decode(client_token).decode().split('.', 1)[1]))
            if signed['pathname'] != pathname:
                raise HTTPException(403, 'The client token was issued for another pathname.')
            store[pathname] = await request.body()
            url = f'https://disposable.private.blob.vercel-storage.com/{pathname}'
            return {'url': url, 'downloadUrl': f'{url}?download=1', 'pathname': pathname,
                    'contentType': 'application/octet-stream', 'contentDisposition': 'attachment'}
        # Um gerente e um membro por eixo, para as jornadas de isolamento entre eixos.
        accounts = [(role, role, 'vendas' if role == 'membro' else None)
                    for role in ['admin', 'organizador', 'membro', 'trainee']]
        for axis in ['vendas', 'conexoes', 'experiencia']:
            accounts += [(f'gerente-{axis}', 'gerente', axis), (f'membro-{axis}', 'membro', axis)]
        password_hash = get_password_hash('qa-test-password')
        with SessionLocal() as db:
            for account, role, eixo in accounts:
                db.add(models.User(
                    id=account, name=account.capitalize(), email=f'{account}@example.com',
                    type=role, cargo=role, password_hash=password_hash,
                    pontos_acumulados=0, eixo=eixo,
                    # As jornadas não esperam o aviso de troca de senha; só a conta abaixo o vê.
                    password_prompt_pending=False,
                ))
            db.add(models.User(
                id='primeiro-acesso', name='Primeiro acesso', email='primeiro-acesso@example.com',
                type='trainee', cargo='trainee', password_hash=password_hash, pontos_acumulados=0,
            ))
            db.commit()
        print(f'Banco descartável: {database}', flush=True)
        print('Contas: admin/organizador/membro/trainee@example.com, gerente-<eixo>@example.com e '
              'membro-<eixo>@example.com (vendas, conexoes, experiencia), primeiro-acesso@example.com (vê o aviso '
              'de troca de senha); senha de teste: qa-test-password', flush=True)
        try:
            uvicorn.run(app, host='127.0.0.1', port=args.port)
        finally:
            engine.dispose()


if __name__ == '__main__':
    main()
