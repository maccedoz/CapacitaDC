"""Managers administer one member axis plus PlugInfo; the library only shows reached materials."""
import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
import test_creation
from app import models
from app.api import auth, games, grades, users
from app.auth import create_access_token
from app.services import blob_storage

AXES = ['vendas', 'conexoes', 'experiencia']
# Gerentes e membros guardam o eixo de formas diferentes de propósito: nomes de
# exibição antigos devem produzir a mesma autorização que os códigos.
STORED_AXIS = {
    'gerente_vendas': 'vendas', 'gerente_conexoes': 'Conexões', 'gerente_experiencia': 'experiencia',
    'membro_vendas': 'Vendas', 'membro_conexoes': 'conexoes', 'membro_experiencia': 'Experiência do Consumidor',
}


def other_axes(axis):
    return [item for item in AXES if item != axis]


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(auth.router, prefix='/api/auth')
        self.api.app.include_router(users.router, prefix='/api/users')
        self.api.app.include_router(grades.router, prefix='/api')
        self.api.app.include_router(games.router, prefix='/api')
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            for user_id, eixo in STORED_AXIS.items():
                kind = user_id.split('_')[0]
                db.add(models.User(id=user_id, name=user_id, email=f'{user_id}@example.com', password_hash='unused',
                                   cargo='Gerente' if kind == 'gerente' else 'Membro', type=kind, eixo=eixo))
            db.add(models.User(id='trainee', name='Trainee', email='trainee@example.com',
                               password_hash='unused', cargo='Trainee', type='trainee'))
            db.commit()
        self.store = {}
        self.patches = [
            patch.object(blob_storage, 'upload', side_effect=lambda path, data, content_type=None: self.store.__setitem__(path, data) or path),
            patch.object(blob_storage, 'download', side_effect=self.store.get),
            patch.object(blob_storage, 'delete', side_effect=lambda path: self.store.pop(path, None)),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.api.tearDown()

    # -- helpers -----------------------------------------------------------

    def user(self, user_id):
        with self.api.sessions() as db:
            user = db.get(models.User, user_id)
            db.expunge(user)
            return user

    def content(self, axis, role='admin'):
        material = self.create('materials', {'name': f'Material {axis}', 'type': 'membro', 'eixo': axis}, role=role)
        activity = self.create('activities', {'title': f'Atividade {axis}', 'eixo': axis,
                                              'material_id': material['id'], 'accepts_file': False}, role=role)
        node = self.create('nodes', {'type': 'activity', 'eixo': axis, 'activity_id': activity['id'],
                                     'is_released': True}, role=role)
        return material, activity, node

    def upload(self, role, name='guia.pdf'):
        with self.api.sessions() as db:
            result = asyncio.run(grades.upload_file(UploadFile(filename=name, file=BytesIO(b'%PDF-1.4')),
                                                    db, db.get(models.User, role)))
        return result['url']

    def test_material_upload_checks_the_file_signature(self):
        cases = [
            ('falso.pdf', b'<html><script>alert(1)</script>', 400),
            ('imagem.png', b'%PDF-1.4', 400),
            ('planilha.xlsx', b'nao e zip', 400),
            ('foto.webp', b'RIFF\x00\x00\x00\x00WEBPVP8 ', 200),
            ('apresentacao.pptx', b'PK\x03\x04resto', 200),
            ('antigo.doc', b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1resto', 200),
            ('notas.txt', b'qualquer texto', 200),
        ]
        for name, contents, expected in cases:
            with self.subTest(name=name), self.api.sessions() as db:
                try:
                    asyncio.run(grades.upload_file(UploadFile(filename=name, file=BytesIO(contents)),
                                                   db, db.get(models.User, 'admin')))
                    status = 200
                except HTTPException as error:
                    status = error.status_code
                self.assertEqual(status, expected)

    def can_download(self, role, url):
        with self.api.sessions() as db:
            try:
                grades.download_uploaded_file(url.removeprefix('/api/uploads/'), db, db.get(models.User, role))
            except HTTPException as error:
                self.assertEqual(error.status_code, 403)
                return False
        return True

    # -- naming managers ---------------------------------------------------

    def test_admin_names_manager_in_each_axis_and_axis_is_required(self):
        for axis in AXES:
            with self.subTest(axis=axis):
                status, body = self.request('POST', '/api/users', {
                    'name': 'Novo gerente', 'email': f'novo_{axis}@example.com', 'cargo': 'gerente',
                    'type': 'gerente', 'eixo': axis, 'password': 'test-only'})
                self.assertEqual(status, 200, body)
                self.assertEqual((body['type'], body['eixo'], body['cargo']), ('gerente', axis, 'Gerente'))
        for eixo in [None, '', 'pluginfo', 'trainee', 'Vend']:
            with self.subTest(eixo=eixo):
                status, _ = self.request('POST', '/api/users', {
                    'name': 'Sem eixo', 'email': 'sem@example.com', 'cargo': 'gerente', 'type': 'gerente', 'eixo': eixo,
                    'password': 'test-only'})
                self.assertEqual(status, 422)
        # Promoção de alguém sem eixo exige o eixo no mesmo pedido.
        self.assertEqual(self.request('PUT', '/api/users/membro', {'type': 'gerente'})[0], 422)
        status, body = self.request('PUT', '/api/users/membro', {'type': 'gerente', 'eixo': 'Conexões'})
        self.assertEqual(status, 200, body)
        self.assertEqual((body['eixo'], body['cargo']), ('conexoes', 'Gerente'))
        self.assertEqual(self.request('PUT', '/api/users/gerente_vendas', {'eixo': ''})[0], 422)
        self.assertEqual(self.request('PUT', '/api/users/gerente_vendas', {'eixo': 'vendas,conexoes'})[0], 422)
        self.assertEqual(self.user('gerente_vendas').eixo, 'vendas')
        for role in ['organizador', 'gerente_vendas']:
            with self.subTest(role=role):
                status, _ = self.request('POST', '/api/users', {
                    'name': 'X', 'email': 'x@example.com', 'cargo': 'gerente', 'type': 'gerente', 'eixo': 'vendas',
                    'password': 'test-only'}, role=role)
                self.assertEqual(status, 403)

    # -- members -----------------------------------------------------------

    def test_each_manager_manages_own_members_and_trainees(self):
        for axis in AXES:
            manager, member = f'gerente_{axis}', f'membro_{axis}'
            with self.subTest(manager=manager):
                status, listing = self.request('GET', '/api/users', role=manager)
                self.assertEqual(status, 200)
                self.assertEqual({row['id'] for row in listing}, {member, 'trainee'})
                self.assertEqual(self.request('GET', f'/api/users/{member}/profile', role=manager)[0], 200)
                status, body = self.request('PUT', f'/api/users/{member}', {'name': 'Renomeado', 'cargo': 'Membro',
                                                                           'type': 'membro', 'eixo': axis,
                                                                           'password': 'new-password'}, role=manager)
                self.assertEqual(status, 200, body)
                self.assertEqual((body['name'], body['eixo']), ('Renomeado', axis))
                outsiders = [f'membro_{other}' for other in other_axes(axis)] + [
                    f'gerente_{other}' for other in other_axes(axis)] + ['admin', 'organizador', 'membro']
                for target in outsiders:
                    for method, path, payload in [('GET', f'/api/users/{target}/profile', None),
                                                  ('PUT', f'/api/users/{target}', {'name': 'Invadido'}),
                                                  ('DELETE', f'/api/users/{target}', None)]:
                        self.assertEqual(self.request(method, path, payload, role=manager)[0], 403, (method, target))
                status, body = self.request('POST', '/api/users', {
                    'name': 'Novo', 'email': f'novo_{axis}@example.com', 'cargo': 'membro', 'type': 'membro',
                    'eixo': axis, 'password': 'test-only'}, role=manager)
                self.assertEqual(status, 200, body)
                self.assertEqual((body['type'], body['eixo'], body['cargo']), ('membro', axis, 'Membro'))
                self.assertEqual(self.request('DELETE', f"/api/users/{body['id']}", role=manager)[0], 200)
                # Como o organizador do PlugInfo, também cadastra trainees.
                status, body = self.request('POST', '/api/users', {
                    'name': 'Trainee novo', 'email': f'trainee_{axis}@example.com', 'cargo': 'trainee',
                    'type': 'trainee', 'password': 'test-only'}, role=manager)
                self.assertEqual(status, 200, body)
                self.assertEqual((body['type'], body['eixo'], body['cargo']), ('trainee', None, 'Trainee'))
                self.assertEqual(self.request('GET', f"/api/users/{body['id']}/profile", role=manager)[0], 200)
                self.assertEqual(self.request('DELETE', f"/api/users/{body['id']}", role=manager)[0], 200)
                for kind, eixo in [('membro', other_axes(axis)[0]), ('membro', None),
                                   ('gerente', axis), ('admin', None), ('organizador', None)]:
                    status, _ = self.request('POST', '/api/users', {
                        'name': 'Fora', 'email': f'fora_{axis}@example.com', 'cargo': kind, 'type': kind, 'eixo': eixo,
                        'password': 'test-only'}, role=manager)
                    self.assertEqual(status, 403, (kind, eixo))
        with self.api.sessions() as db:
            self.assertEqual(db.query(models.User).filter(models.User.name == 'Invadido').count(), 0)

    def test_manipulated_requests_cannot_promote_move_or_escalate(self):
        before = self.user('membro_vendas')
        for payload in [{'type': 'gerente'}, {'type': 'admin'}, {'type': 'organizador'}, {'type': 'trainee'},
                        {'eixo': 'conexoes'}, {'eixo': None}, {'cargo': 'Administrador'},
                        {'name': 'Parcial', 'type': 'admin'}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.request('PUT', '/api/users/membro_vendas', payload, role='gerente_vendas')[0], 403)
        after = self.user('membro_vendas')
        self.assertEqual((after.name, after.type, after.eixo, after.cargo), (before.name, before.type, before.eixo, before.cargo))
        # Nem sobre si mesmo: o próprio papel e o eixo são decisões do administrador.
        for payload in [{'eixo': 'conexoes'}, {'type': 'admin'}, {'name': 'Eu'}]:
            self.assertEqual(self.request('PUT', '/api/users/gerente_vendas', payload, role='gerente_vendas')[0], 403)
        status, me = self.request('GET', '/api/auth/me', role='gerente_vendas')
        self.assertEqual((status, me['type'], me['eixo']), (200, 'gerente', 'vendas'))
        # Trainee continua trainee: virar membro, mesmo do próprio eixo, é promoção.
        for payload in [{'type': 'membro', 'eixo': 'vendas'}, {'type': 'gerente', 'eixo': 'vendas'},
                        {'type': 'organizador'}, {'cargo': 'Membro'}]:
            self.assertEqual(self.request('PUT', '/api/users/trainee', payload, role='gerente_vendas')[0], 403, payload)
        self.assertEqual(self.user('trainee').type, 'trainee')

    def test_role_and_axis_changes_apply_to_open_sessions(self):
        token = create_access_token({'sub': 'gerente_vendas', 'sub_type': 'user_id'})
        members = lambda listing: [row['id'] for row in listing if row['type'] == 'membro']
        _, listing = self.request('GET', '/api/users', role=None, token=token)
        self.assertEqual(members(listing), ['membro_vendas'])
        self.assertEqual(self.request('PUT', '/api/users/gerente_vendas', {'eixo': 'conexoes'})[0], 200)
        _, listing = self.request('GET', '/api/users', role=None, token=token)
        self.assertEqual(members(listing), ['membro_conexoes'])
        self.assertEqual(self.request('PUT', '/api/users/gerente_vendas', {'type': 'membro', 'cargo': 'membro'})[0], 200)
        self.assertEqual(self.request('GET', '/api/grades', role=None, token=token)[0], 403)
        self.assertEqual(self.request('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': 'conexoes'},
                                      role=None, token=token)[0], 403)

    def test_manager_with_unknown_axis_gets_no_access(self):
        with self.api.sessions() as db:
            db.get(models.User, 'gerente_vendas').eixo = 'Marketing'
            db.commit()
        self.content('vendas')
        self.assertEqual(self.request('GET', '/api/users', role='gerente_vendas')[0], 403)
        for method, path, payload in [('GET', '/api/grades', None), ('GET', '/api/submissions', None),
                                      ('GET', '/api/games', None),
                                      ('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': 'vendas'})]:
            self.assertEqual(self.request(method, path, payload, role='gerente_vendas')[0], 403, path)
        for resource in ['materials', 'activities', 'nodes']:
            self.assertEqual(self.request('GET', f'/api/{resource}', role='gerente_vendas'), (200, []), resource)

    # -- content -----------------------------------------------------------

    def test_each_manager_authors_only_own_axis_and_plugin_content(self):
        seeded = {axis: self.content(axis) for axis in AXES}
        trainee_material = self.create('materials', {'name': 'Trainee', 'type': 'trainee', 'eixo': 'trainee'})
        shared_activity = self.create('activities', {'title': 'Todos', 'eixo': 'all'})
        for axis in AXES:
            manager = f'gerente_{axis}'
            with self.subTest(manager=manager):
                material, activity, node = self.content(axis, role=manager)
                self.create('games', {'title': 'Jogo', 'eixo': axis, 'format': 'quiz'}, role=manager)
                own = {seeded[axis][0]['id'], material['id'], trainee_material['id']}
                # Conteúdo `all` aparece como para o organizador, mas não é editável.
                for resource, expected in [('materials', own),
                                           ('activities', {seeded[axis][1]['id'], activity['id'], shared_activity['id']}),
                                           ('nodes', {seeded[axis][2]['id'], node['id']})]:
                    _, listing = self.request('GET', f'/api/{resource}', role=manager)
                    self.assertEqual({row['id'] for row in listing}, expected, resource)
                _, library = self.request('GET', '/api/games', role=manager)
                self.assertEqual({row['eixo'] for row in library}, {axis})

                self.assertEqual(self.request('PUT', f"/api/materials/{material['id']}", {
                    'name': 'Atualizado', 'type': 'membro', 'eixo': axis, 'text': 'Veja https://example.com'}, role=manager)[0], 200)
                self.assertEqual(self.request('PATCH', f"/api/nodes/{node['id']}/release", {
                    'is_released': True, 'released_at': '2030-01-01T00:00:00Z'}, role=manager)[0], 200)
                self.assertEqual(self.request('PATCH', f"/api/nodes/{node['id']}/order", {'order_index': 0}, role=manager)[0], 200)
                self.assertEqual(self.request('PATCH', f"/api/activities/{activity['id']}", {'weight': 2}, role=manager)[0], 200)

                for target in [seeded[other_axes(axis)[0]], seeded[other_axes(axis)[1]]]:
                    other_material, other_activity, other_node = target
                    for method, path, payload in [
                        ('PUT', f"/api/materials/{other_material['id']}", {'name': 'X', 'type': 'membro', 'eixo': axis}),
                        ('DELETE', f"/api/materials/{other_material['id']}", None),
                        ('PATCH', f"/api/activities/{other_activity['id']}", {'title': 'X'}),
                        ('DELETE', f"/api/activities/{other_activity['id']}", None),
                        ('GET', f"/api/activities/{other_activity['id']}/submissions", None),
                        ('PATCH', f"/api/nodes/{other_node['id']}/release", {'is_released': False}),
                        ('PATCH', f"/api/nodes/{other_node['id']}/order", {'order_index': 9}),
                        ('PATCH', f"/api/nodes/{other_node['id']}/activity", {'activity_id': activity['id']}),
                        ('DELETE', f"/api/nodes/{other_node['id']}", None),
                        ('GET', f"/api/nodes/{other_node['id']}/content", None),
                    ]:
                        self.assertEqual(self.request(method, path, payload, role=manager)[0], 403, (method, path))
                # Pedidos que puxam recursos de outro eixo ou movem os próprios para fora.
                other = other_axes(axis)[0]
                for method, path, payload in [
                    ('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': other}),
                    ('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': 'all'}),
                    ('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': 'trainee'}),
                    ('POST', '/api/materials', {'name': 'X', 'type': 'trainee', 'eixo': axis}),
                    ('PUT', f"/api/materials/{material['id']}", {'name': 'X', 'type': 'membro', 'eixo': other}),
                    ('POST', '/api/activities', {'title': 'X', 'eixo': other}),
                    ('POST', '/api/activities', {'title': 'X', 'eixo': 'all'}),
                    ('POST', '/api/activities', {'title': 'X', 'eixo': axis, 'material_id': seeded[other][0]['id']}),
                    ('PATCH', f"/api/activities/{activity['id']}", {'material_id': seeded[other][0]['id']}),
                    ('PATCH', f"/api/activities/{shared_activity['id']}", {'title': 'X'}),
                    ('POST', '/api/nodes', {'type': 'activity', 'eixo': axis, 'activity_id': seeded[other][1]['id']}),
                    ('POST', '/api/nodes', {'type': 'activity', 'eixo': axis, 'activity_id': shared_activity['id']}),
                    ('POST', '/api/nodes', {'type': 'activity', 'eixo': other, 'activity_id': activity['id']}),
                    ('POST', '/api/nodes', {'type': 'activity', 'eixo': axis, 'activity_id': activity['id'],
                                            'prerequisite_node_id': seeded[other][2]['id']}),
                    ('POST', '/api/nodes', {'type': 'material', 'eixo': axis, 'reference_id': seeded[other][0]['id']}),
                    ('POST', '/api/games', {'title': 'X', 'eixo': other, 'format': 'quiz'}),
                ]:
                    self.assertEqual(self.request(method, path, payload, role=manager)[0], 403, (method, path, payload))
        with self.api.sessions() as db:
            self.assertEqual(db.query(models.Material).filter(models.Material.name == 'X').count(), 0)
            self.assertEqual(db.query(models.Activity).filter(models.Activity.title == 'X').count(), 0)
            self.assertEqual(db.query(models.Game).filter(models.Game.title == 'X').count(), 0)

    def test_legacy_links_shared_with_another_axis_are_left_to_the_admin(self):
        material, activity, _ = self.content('vendas')
        with self.api.sessions() as db:
            db.add(models.TrainingNode(id='legacy', name='Etapa antiga', type='activity', eixo='conexoes',
                                       activity_id=activity['id'], is_released=True))
            db.commit()
        for method, path, payload in [
            ('PUT', f"/api/materials/{material['id']}", {'name': 'X', 'type': 'membro', 'eixo': 'vendas'}),
            ('DELETE', f"/api/materials/{material['id']}", None),
            ('PATCH', f"/api/activities/{activity['id']}", {'title': 'X'}),
            ('DELETE', f"/api/activities/{activity['id']}", None),
        ]:
            self.assertEqual(self.request(method, path, payload, role='gerente_vendas')[0], 403, (method, path))
        status, _ = self.request('PUT', f"/api/materials/{material['id']}", {'name': 'Admin', 'type': 'membro', 'eixo': 'vendas'})
        self.assertEqual(status, 200)

    def test_managers_also_run_plugin_content_and_trainees(self):
        for axis in AXES:
            manager = f'gerente_{axis}'
            with self.subTest(manager=manager):
                material = self.create('materials', {'name': 'PlugInfo', 'type': 'trainee', 'eixo': 'trainee'}, role=manager)
                activity = self.create('activities', {'title': 'PlugInfo', 'eixo': 'trainee', 'accepts_file': False,
                                                      'material_id': material['id']}, role=manager)
                node = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'],
                                             'is_released': True}, role=manager)
                self.create('games', {'title': 'Jogo PlugInfo', 'eixo': 'trainee', 'format': 'quiz'}, role=manager)
                self.assertEqual(self.request('PUT', f"/api/materials/{material['id']}", {
                    'name': 'PlugInfo editado', 'type': 'trainee', 'eixo': 'trainee'}, role=manager)[0], 200)
                self.assertEqual(self.request('PATCH', f"/api/nodes/{node['id']}/release", {'is_released': True}, role=manager)[0], 200)
                self.assertEqual(self.request('PUT', '/api/users/trainees/trainee', {'rotacao': 2}, role=manager)[0], 200)

                status, body = self.request('POST', f"/api/activities/{activity['id']}/submit",
                                            {'node_id': node['id'], 'comment': 'Entrega'}, role='trainee')
                self.assertEqual(status, 200, body)
                _, queue = self.request('GET', '/api/submissions', role=manager)
                self.assertIn(body['id'], [row['id'] for row in queue])
                path = f"/api/activities/{activity['id']}/submissions/{body['id']}"
                self.assertEqual(self.request('PATCH', path, {'grade': 7}, role=manager)[0], 200)
                # O organizador enxerga o que o gerente fez, e vice-versa: é o mesmo conteúdo.
                self.assertEqual(self.request('PATCH', f"/api/activities/{activity['id']}", {'title': 'Pelo organizador'},
                                              role='organizador')[0], 200)
                self.assertEqual(self.request('DELETE', path, role=manager)[0], 200)
                self.assertEqual(self.request('DELETE', f"/api/nodes/{node['id']}", role=manager)[0], 200)
                self.assertEqual(self.request('DELETE', f"/api/activities/{activity['id']}", role=manager)[0], 200)
        self.assertEqual(self.user('trainee').rotacao, 2)
        # Organizadores seguem limitados ao PlugInfo: o gerente não lhes empresta o eixo.
        self.assertEqual(self.request('POST', '/api/materials', {'name': 'X', 'type': 'membro', 'eixo': 'vendas'},
                                      role='organizador')[0], 403)
        self.assertEqual(self.request('GET', '/api/users/gerente_vendas/profile', role='organizador')[0], 403)

    def test_manager_with_unknown_axis_does_not_keep_plugin_access(self):
        with self.api.sessions() as db:
            db.get(models.User, 'gerente_vendas').eixo = None
            db.commit()
        self.assertEqual(self.request('POST', '/api/materials', {'name': 'X', 'type': 'trainee', 'eixo': 'trainee'},
                                      role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('PUT', '/api/users/trainees/trainee', {'rotacao': 1}, role='gerente_vendas')[0], 403)

    # -- corrections and grades ------------------------------------------

    def test_corrections_need_member_and_activity_of_the_manager_axis(self):
        _, activity, node = self.content('vendas')
        path = f"/api/activities/{activity['id']}"
        submissions = {}
        # Membros enxergam as trilhas dos três eixos, então alguém de Conexões também entrega aqui.
        for member in ['membro_vendas', 'membro_conexoes']:
            status, body = self.request('POST', f'{path}/submit', {'node_id': node['id'], 'comment': member}, role=member)
            self.assertEqual(status, 200, body)
            submissions[member] = body['id']
        _, rows = self.request('GET', f'{path}/submissions', role='gerente_vendas')
        self.assertEqual([row['user_id'] for row in rows], ['membro_vendas'])
        _, queue = self.request('GET', '/api/submissions', role='gerente_vendas')
        self.assertEqual([row['user_id'] for row in queue], ['membro_vendas'])
        _, listing = self.request('GET', '/api/activities', role='gerente_vendas')
        self.assertEqual(listing[0]['submission_count'], 1)
        self.assertEqual(self.request('PATCH', f"{path}/submissions/{submissions['membro_conexoes']}", {'grade': 2},
                                      role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('DELETE', f"{path}/submissions/{submissions['membro_conexoes']}",
                                      role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('PATCH', f"{path}/submissions/{submissions['membro_vendas']}", {'grade': 8},
                                      role='gerente_vendas')[0], 200)
        # Apagar ou mudar o peso alteraria a nota de quem é acompanhado por outro gerente.
        self.assertEqual(self.request('DELETE', path, role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('PATCH', path, {'weight': 3}, role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('PATCH', path, {'title': 'Novo título'}, role='gerente_vendas')[0], 200)
        # O gerente do outro eixo não corrige nesta atividade, mesmo sendo seu membro.
        self.assertEqual(self.request('GET', f'{path}/submissions', role='gerente_conexoes')[0], 403)
        self.assertEqual(self.request('PATCH', f"{path}/submissions/{submissions['membro_conexoes']}", {'grade': 2},
                                      role='gerente_conexoes')[0], 403)
        self.assertEqual(self.request('GET', '/api/submissions', role='gerente_conexoes'), (200, []))

    def test_grades_and_profile_are_scoped_to_the_manager_axis(self):
        _, sales_activity, sales_node = self.content('vendas')
        other_material = self.create('materials', {'name': 'Conexões', 'type': 'membro', 'eixo': 'conexoes'})
        other_node = self.create('nodes', {'type': 'material', 'eixo': 'conexoes', 'reference_id': other_material['id'],
                                           'is_released': True})
        status, body = self.request('POST', f"/api/activities/{sales_activity['id']}/submit",
                                    {'node_id': sales_node['id'], 'comment': 'Entrega'}, role='membro_vendas')
        self.assertEqual(status, 200, body)
        self.request('PATCH', f"/api/activities/{sales_activity['id']}/submissions/{body['id']}", {'grade': 9})
        self.assertEqual(self.request('POST', f"/api/nodes/{other_node['id']}/complete", role='membro_vendas')[0], 200)
        self.assertEqual(self.user('membro_vendas').pontos_acumulados, 50)

        _, rows = self.request('GET', '/api/grades', role='gerente_vendas')
        self.assertEqual({item['id'] for item in rows}, {'membro_vendas', 'trainee'})
        row = next(item for item in rows if item['id'] == 'membro_vendas')
        self.assertEqual((row['id'], row['nodes_completed'], row['nodes_total'], row['pontos_acumulados'], row['nota_rotacao']),
                         ('membro_vendas', 1, 1, 0, 9.0))
        _, profile = self.request('GET', '/api/users/membro_vendas/profile', role='gerente_vendas')
        self.assertEqual([item['node_id'] for item in profile['node_progress']], [sales_node['id']])
        self.assertEqual(profile['pontos_acumulados'], 0)
        # Os totais globais continuam intactos para quem vê tudo.
        _, profile = self.request('GET', '/api/users/membro_vendas/profile')
        self.assertEqual(profile['pontos_acumulados'], 50)
        _, admin_rows = self.request('GET', '/api/grades')
        legacy = next(item for item in admin_rows if item['id'] == 'membro_vendas')
        self.assertEqual(legacy['nodes_total'], 1)  # eixo gravado como "Vendas" conta a trilha certa
        self.assertEqual(next(item for item in admin_rows if item['id'] == 'membro_conexoes')['nodes_total'], 1)

    def test_participants_cannot_list_people_and_ranking_is_gone(self):
        # Pela ferramenta de inspeção dava para ler e-mails, médias e pontos de todos.
        for role in ['membro', 'membro_vendas', 'trainee']:
            with self.subTest(role=role):
                self.assertEqual(self.request('GET', '/api/users', role=role)[0], 403)
                self.assertEqual(self.request('GET', '/api/leaderboard', role=role)[0], 404)
        for role in ['admin', 'organizador', 'gerente_vendas']:
            self.assertEqual(self.request('GET', '/api/users', role=role)[0], 200, role)

    # -- library --------------------------------------------------------------

    def trail(self, count, eixo='trainee', material_type='trainee'):
        items = []
        for index in range(count):
            material = self.create('materials', {'name': f'Etapa {index + 1}', 'type': material_type, 'eixo': eixo})
            node = self.create('nodes', {'type': 'material', 'eixo': eixo, 'reference_id': material['id'], 'is_released': True})
            items.append((material, node))
        return items

    def library(self, role='trainee'):
        status, listing = self.request('GET', '/api/materials', role=role)
        self.assertEqual(status, 200, listing)
        return [row['id'] for row in listing]

    def test_library_shows_materials_of_reached_steps_before_completion(self):
        steps = self.trail(10)
        for material, node in steps[:2]:
            self.assertEqual(self.request('POST', f"/api/nodes/{node['id']}/complete", role='trainee')[0], 200)
        self.assertEqual(sorted(self.library()), sorted(material['id'] for material, _ in steps[:3]))
        status, content = self.request('GET', f"/api/nodes/{steps[2][1]['id']}/content", role='trainee')
        self.assertEqual((status, content['material']['id']), (200, steps[2][0]['id']))
        self.assertEqual(self.request('GET', f"/api/nodes/{steps[3][1]['id']}/content", role='trainee')[0], 403)
        # Staff prepara conteúdo sem cumprir a trilha.
        self.assertEqual(len(self.library('organizador')), 10)

    def test_library_needs_a_reachable_step_in_an_allowed_trail(self):
        (first, first_node), (second, second_node) = self.trail(2)
        standalone = self.create('materials', {'name': 'Avulso', 'type': 'trainee', 'eixo': 'trainee'})
        activity_only = self.create('materials', {'name': 'Só na atividade', 'type': 'trainee', 'eixo': 'trainee'})
        self.create('activities', {'title': 'Fora da trilha', 'eixo': 'trainee', 'material_id': activity_only['id']})
        self.assertEqual(self.library(), [first['id']])

        # Liberado pelo administrador, mas agendado para o futuro: ainda não alcançado.
        self.request('POST', f"/api/nodes/{first_node['id']}/complete", role='trainee')
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        self.request('PATCH', f"/api/nodes/{second_node['id']}/release", {'is_released': True, 'released_at': future})
        self.assertEqual(self.library(), [first['id']])
        self.request('PATCH', f"/api/nodes/{second_node['id']}/release", {'is_released': True})
        self.assertEqual(sorted(self.library()), sorted([first['id'], second['id']]))

        # O mesmo material em duas etapas aparece uma vez; basta uma etapa alcançada.
        self.create('nodes', {'type': 'material', 'eixo': 'trainee', 'reference_id': first['id'], 'is_released': False})
        self.assertEqual(sorted(self.library()), sorted([first['id'], second['id']]))

        # Bloquear a etapa de novo recalcula o acesso nas consultas seguintes.
        self.request('PATCH', f"/api/nodes/{second_node['id']}/release", {'is_released': False})
        self.assertEqual(self.library(), [first['id']])
        self.assertNotIn(standalone['id'], self.library())
        self.assertNotIn(activity_only['id'], self.library())

        # Uma etapa de trilha que o trainee não vê não libera material, mesmo aberta.
        member_steps = self.trail(1, eixo='vendas', material_type='trainee')
        self.assertNotIn(member_steps[0][0]['id'], self.library())
        self.assertIn(member_steps[0][0]['id'], self.library('membro_conexoes'))

    # -- files ------------------------------------------------------------------

    def test_material_files_follow_material_access(self):
        url = self.upload('gerente_vendas')
        # Antes do vínculo, só quem enviou (ou outro gerente do mesmo eixo) consegue abrir.
        self.assertTrue(self.can_download('gerente_vendas', url))
        self.assertTrue(self.can_download('admin', url))
        for role in ['gerente_conexoes', 'organizador', 'membro_vendas', 'trainee']:
            self.assertFalse(self.can_download(role, url), role)
        for document_url in [url, f'https://capacita.example{url}']:
            status, _ = self.request('POST', '/api/materials', {'name': 'Puxado', 'type': 'membro', 'eixo': 'conexoes',
                                                                'documents': [{'name': 'Guia', 'url': document_url}]},
                                     role='gerente_conexoes')
            self.assertEqual(status, 403, document_url)

        material = self.create('materials', {'name': 'Guia', 'type': 'membro', 'eixo': 'vendas',
                                             'documents': [{'name': 'Guia', 'url': url}]}, role='gerente_vendas')
        # Conhecer a URL não basta: o participante precisa ter alcançado a etapa.
        self.assertFalse(self.can_download('membro_vendas', url))
        node = self.create('nodes', {'type': 'material', 'eixo': 'vendas', 'reference_id': material['id']}, role='gerente_vendas')
        self.assertFalse(self.can_download('membro_vendas', url))
        self.request('PATCH', f"/api/nodes/{node['id']}/release", {'is_released': True}, role='gerente_vendas')
        self.assertTrue(self.can_download('membro_vendas', url))
        self.assertFalse(self.can_download('trainee', url))
        self.assertFalse(self.can_download('gerente_conexoes', url))
        # Editar o texto mantém documentos antigos sem novo envio.
        status, _ = self.request('PUT', f"/api/materials/{material['id']}", {
            'name': 'Guia', 'type': 'membro', 'eixo': 'vendas', 'text': 'Novo texto',
            'documents': [{'name': 'Guia', 'url': url}]}, role='gerente_vendas')
        self.assertEqual(status, 200)

    def test_legacy_files_are_authorized_through_existing_documents(self):
        self.store['materials/antigo.pdf'] = b'legacy'
        url = '/api/uploads/materials/antigo.pdf'
        self.create('materials', {'name': 'Antigo', 'type': 'membro', 'eixo': 'conexoes',
                                  'documents': [{'name': 'Antigo', 'url': url}]})
        self.assertTrue(self.can_download('gerente_conexoes', url))
        for role in ['gerente_vendas', 'organizador', 'membro_conexoes']:
            self.assertFalse(self.can_download(role, url), role)
        self.assertFalse(self.can_download('gerente_vendas', '/api/uploads/materials/sem-vinculo.pdf'))


if __name__ == '__main__':
    unittest.main()
