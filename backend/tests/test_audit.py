"""Histórico de alterações: o que cada rota da gestão registra e quem consulta o quê."""
import json
import unittest
from datetime import datetime, timezone

import test_creation
from app import models
from app.api import audit, games, users

PASSWORD = 'segredo-de-teste'
QUIZ = {"questions": [
    {"id": "q1", "text": "Pergunta", "selection": "single", "weight": 1,
     "options": [{"id": "a", "text": "Certa", "is_correct": True}, {"id": "b", "text": "Errada", "is_correct": False}]},
]}


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(users.router, prefix='/api/users')
        self.api.app.include_router(games.router, prefix='/api')
        self.api.app.include_router(audit.router, prefix='/api/audit')
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            for user_id, kind, eixo in [('gerente_vendas', 'gerente', 'vendas'), ('gerente_conexoes', 'gerente', 'conexoes'),
                                        ('membro_vendas', 'membro', 'vendas'), ('trainee', 'trainee', None)]:
                db.add(models.User(id=user_id, name=user_id, email=f'{user_id}@example.com', password_hash='unused',
                                   cargo=kind, type=kind, eixo=eixo))
            db.commit()

    def tearDown(self):
        self.api.tearDown()

    # -- helpers -----------------------------------------------------------

    def entries(self, action=None):
        with self.api.sessions() as db:
            query = db.query(models.AuditLog).order_by(models.AuditLog.created_at)
            if action:
                query = query.filter(models.AuditLog.action == action)
            rows = query.all()
            for row in rows:
                db.expunge(row)
            return rows

    def only(self, action):
        rows = self.entries(action)
        self.assertEqual(len(rows), 1, [row.action for row in self.entries()])
        return rows[0]

    def ok(self, method, path, payload=None, role='admin'):
        status, body = self.request(method, path, payload, role)
        self.assertEqual(status, 200, body)
        return body

    def history(self, query='', role='admin'):
        return self.ok('GET', f'/api/audit{query}', role=role)

    # -- what each area records ---------------------------------------------

    def test_activity_create_update_and_delete(self):
        material = self.create('materials', {'name': 'Guia', 'type': 'membro', 'eixo': 'vendas'})
        activity = self.create('activities', {'title': 'Relatório', 'eixo': 'vendas', 'accepts_file': False})
        created = self.only('activity.create')
        self.assertEqual((created.actor_id, created.actor_name, created.entity_type, created.entity_id,
                          created.entity_name, created.eixo), ('admin', 'admin', 'activity', activity['id'], 'Relatório', 'vendas'))
        path = f"/api/activities/{activity['id']}"

        # Só o prazo muda; salvar de novo o mesmo instante, com outro fuso, não registra.
        self.ok('PATCH', path, {'title': 'Relatório', 'deadline': '2030-01-02T17:00:00Z', 'is_open': True})
        self.assertEqual(len(self.entries('activity.update')), 1)
        self.ok('PATCH', path, {'title': 'Relatório', 'deadline': '2030-01-02T14:00:00-03:00', 'weight': 1})
        self.assertEqual(len(self.entries('activity.update')), 1)

        self.ok('PATCH', path, {'title': 'Relatório final', 'weight': 3, 'material_id': material['id']})
        updates = self.entries('activity.update')
        self.assertEqual(len(updates), 2)
        self.assertEqual(updates[0].details, {'prazo': {'antes': None, 'depois': '2030-01-02T17:00:00Z'}})
        self.assertEqual(updates[1].details, {
            'título': {'antes': 'Relatório', 'depois': 'Relatório final'},
            'peso': {'antes': 1.0, 'depois': 3.0},
            'material': {'antes': None, 'depois': 'Guia'},
        })
        self.assertEqual(updates[1].entity_name, 'Relatório final')

        self.ok('DELETE', path)
        deleted = self.only('activity.delete')
        self.assertEqual((deleted.entity_id, deleted.entity_name, deleted.eixo), (activity['id'], 'Relatório final', 'vendas'))

    def test_trail_nodes(self):
        activity = self.create('activities', {'title': 'Tarefa', 'eixo': 'trainee'})
        material = self.create('materials', {'name': 'Leitura', 'type': 'trainee', 'eixo': 'trainee'})
        first = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'], 'name': 'Módulo 1'},
                            role='organizador')
        second = self.create('nodes', {'type': 'material', 'eixo': 'trainee', 'reference_id': material['id']})
        created = self.entries('node.create')
        self.assertEqual([(row.actor_id, row.entity_name, row.eixo) for row in created],
                         [('organizador', 'Módulo 1', 'trainee'), ('admin', 'Leitura', 'trainee')])

        path = f"/api/nodes/{first['id']}"
        self.ok('PATCH', path, {'name': 'Módulo 1'})
        self.assertEqual(self.entries('node.update'), [])
        self.ok('PATCH', path, {'name': 'Módulo inicial', 'deadline': '2030-03-01T12:00:00Z'})
        self.ok('PATCH', f"/api/nodes/{second['id']}", {'prerequisite_node_id': first['id']})
        renamed, linked = self.entries('node.update')
        self.assertEqual(renamed.details, {'nome': {'antes': 'Módulo 1', 'depois': 'Módulo inicial'},
                                           'prazo': {'antes': None, 'depois': '2030-03-01T12:00:00Z'}})
        self.assertEqual(linked.details, {'pré-requisito': {'antes': None, 'depois': 'Módulo inicial'}})

        self.ok('PATCH', path + '/release', {'is_released': True})
        self.ok('PATCH', path + '/release', {'is_released': True})
        self.ok('PATCH', path + '/release', {'is_released': True, 'released_at': '2030-01-02T14:00:00-03:00'})
        self.ok('PATCH', path + '/release', {'is_released': False})
        releases = self.entries('node.release')
        self.assertEqual([row.details for row in releases], [
            {'liberado': {'antes': False, 'depois': True}},
            {'liberação': {'antes': None, 'depois': '2030-01-02T17:00:00Z'}},
            {'liberado': {'antes': True, 'depois': False}, 'liberação': {'antes': '2030-01-02T17:00:00Z', 'depois': None}},
        ])

        self.ok('PATCH', path + '/order', {'order_index': 0})
        self.assertEqual(self.entries('node.reorder'), [])
        self.ok('PATCH', path + '/order', {'order_index': 1})
        self.ok('PATCH', f"/api/nodes/{second['id']}/order", {'order_index': 0})
        self.assertEqual([(row.entity_id, row.details) for row in self.entries('node.reorder')], [
            (first['id'], {'posição': {'antes': 1, 'depois': 2}}),
            (second['id'], {'posição': {'antes': 2, 'depois': 1}}),
        ])

        self.ok('PATCH', f"/api/nodes/{second['id']}/activity", {'activity_id': activity['id']})
        conversion = self.only('node.link_activity')
        self.assertEqual(conversion.details, {'tipo': {'antes': 'material', 'depois': 'activity'},
                                              'atividade': {'antes': None, 'depois': 'Tarefa'},
                                              'material': {'antes': 'Leitura', 'depois': None}})
        self.ok('PATCH', f"/api/nodes/{second['id']}/activity", {'activity_id': activity['id']})
        self.assertEqual(len(self.entries('node.link_activity')), 1)

        self.ok('DELETE', f"/api/nodes/{second['id']}")
        deleted = self.only('node.delete')
        self.assertEqual((deleted.entity_id, deleted.entity_name, deleted.eixo), (second['id'], 'Leitura', 'trainee'))

    def test_people_never_store_passwords_and_deletion_keeps_the_entry(self):
        person = self.create('users', {'name': 'Fulana', 'email': 'fulana@example.com', 'cargo': 'trainee',
                                       'type': 'trainee', 'password': PASSWORD}, role='gerente_vendas')
        created = self.only('user.create')
        self.assertEqual((created.actor_id, created.target_user_id, created.target_user_name, created.eixo),
                         ('gerente_vendas', person['id'], 'Fulana', 'trainee'))
        self.assertEqual(created.details, {'perfil': 'trainee', 'cargo': 'Trainee'})

        path = f"/api/users/{person['id']}"
        self.ok('PUT', path, {'name': 'Fulana', 'password': ''})
        self.assertEqual(self.entries('user.update'), [])
        self.ok('PUT', path, {'name': 'Fulana de Tal', 'password': 'outra-senha-123'})
        self.ok('PUT', path, {'password': 'mais-uma-senha'})
        renamed, reset = self.entries('user.update')
        self.assertEqual(renamed.details, {'nome': {'antes': 'Fulana', 'depois': 'Fulana de Tal'}, 'senha': 'redefinida'})
        self.assertEqual(reset.details, {'senha': 'redefinida'})

        self.ok('PUT', f"/api/users/trainees/{person['id']}", {'rotacao': 2})
        self.ok('PUT', f"/api/users/trainees/{person['id']}", {'rotacao': 2})
        rotation = self.only('user.rotation')
        self.assertEqual((rotation.details, rotation.eixo), ({'rotação': {'antes': None, 'depois': 2}}, 'trainee'))

        # Membro com eixo antigo gravado pelo nome: regravar como código não é mudança.
        with self.api.sessions() as db:
            db.get(models.User, 'membro_vendas').eixo = 'Vendas'
            db.commit()
        self.ok('PUT', '/api/users/membro_vendas', {'name': 'membro_vendas'}, role='gerente_vendas')
        self.assertEqual(len(self.entries('user.update')), 2)

        self.ok('DELETE', path)
        deleted = self.only('user.delete')
        self.assertEqual((deleted.target_user_name, deleted.entity_name, deleted.eixo), ('Fulana de Tal', 'Fulana de Tal', 'trainee'))
        with self.api.sessions() as db:
            self.assertIsNone(db.get(models.User, person['id']))
            self.assertEqual(db.query(models.AuditLog).count(), len(self.entries()))
        stored = json.dumps([row.details for row in self.entries()], ensure_ascii=False)
        for secret in [PASSWORD, 'outra-senha-123', 'mais-uma-senha']:
            self.assertNotIn(secret, stored)
        names = [item['target_user_name'] for item in self.history()['items'] if item['action'] == 'user.delete']
        self.assertEqual(names, ['Fulana de Tal'])

    def test_materials(self):
        material = self.create('materials', {'name': 'Guia', 'type': 'membro', 'eixo': 'conexoes', 'text': 'Texto',
                                             'documents': [{'name': 'Doc', 'url': 'https://example.com/doc'}]})
        created = self.only('material.create')
        self.assertEqual((created.entity_name, created.eixo), ('Guia', 'conexoes'))
        path = f"/api/materials/{material['id']}"
        same = {'name': 'Guia', 'type': 'membro', 'eixo': 'conexoes', 'text': 'Texto',
                'documents': [{'name': 'Doc', 'url': 'https://example.com/doc'}]}
        self.ok('PUT', path, same)
        self.assertEqual(self.entries('material.update'), [])
        self.ok('PUT', path, {**same, 'name': 'Guia novo', 'text': 'Outro texto', 'documents': [],
                              'videos': ['https://example.com/video']})
        self.assertEqual(self.only('material.update').details, {
            'nome': {'antes': 'Guia', 'depois': 'Guia novo'}, 'texto': 'alterado',
            'documentos': {'antes': 1, 'depois': 0}, 'vídeos': {'antes': 0, 'depois': 1},
        })
        self.ok('DELETE', path)
        self.assertEqual(self.only('material.delete').entity_name, 'Guia novo')

    def test_games_publish_only_records_new_versions(self):
        game = self.create('games', {'title': 'Quiz', 'eixo': 'vendas', 'format': 'quiz', 'config': QUIZ},
                           role='gerente_vendas')
        created = self.only('game.create')
        self.assertEqual((created.entity_id, created.eixo, created.actor_id), (game['id'], 'vendas', 'gerente_vendas'))
        path = f"/api/games/{game['id']}"
        self.ok('PATCH', path, {'title': 'Quiz'})
        self.assertEqual(self.entries('game.update'), [])
        self.ok('PATCH', path, {'title': 'Quiz de vendas', 'instructions': 'Responda'})
        self.assertEqual(self.only('game.update').details,
                         {'título': {'antes': 'Quiz', 'depois': 'Quiz de vendas'}, 'rascunho': 'editado'})

        self.ok('POST', f'{path}/publish', {})
        self.ok('POST', f'{path}/publish', {})
        self.assertEqual(self.only('game.publish').details, {'versão': 1})
        copy = self.ok('POST', f'{path}/duplicate', {})
        duplicate = self.only('game.duplicate')
        self.assertEqual((duplicate.entity_id, duplicate.details), (copy['id'], {'origem': 'Quiz de vendas'}))
        self.ok('DELETE', path)
        self.assertEqual(self.only('game.delete').details, {'versões': 1})

    # -- consulting the history ----------------------------------------------

    def seed_axes(self):
        for eixo in ['vendas', 'conexoes', 'trainee', 'all']:
            self.create('activities', {'title': f'Atividade {eixo}', 'eixo': eixo})
        self.create('users', {'name': 'Novo membro', 'email': 'novo@infojr.com.br', 'cargo': 'membro', 'type': 'membro',
                              'eixo': 'vendas', 'password': PASSWORD}, role='gerente_vendas')
        self.create('activities', {'title': 'Do organizador', 'eixo': 'trainee'}, role='organizador')

    def test_history_is_scoped_by_role(self):
        self.seed_axes()
        seen = {role: {(item['action'], item['eixo']) for item in self.history(role=role)['items']}
                for role in ['admin', 'gerente_vendas', 'gerente_conexoes', 'organizador']}
        self.assertEqual({eixo for _, eixo in seen['admin']}, {'vendas', 'conexoes', 'trainee', 'all'})
        self.assertEqual(seen['gerente_vendas'], {('activity.create', 'vendas'), ('activity.create', 'trainee'),
                                                  ('user.create', 'vendas')})
        self.assertEqual(seen['gerente_conexoes'], {('activity.create', 'conexoes'), ('activity.create', 'trainee')})
        self.assertEqual(seen['organizador'], {('activity.create', 'trainee')})
        organizer = self.history(role='organizador')
        self.assertEqual(organizer['total'], 2)
        self.assertEqual(organizer['actors'], [{'id': 'admin', 'name': 'admin'}, {'id': 'organizador', 'name': 'organizador'}])
        self.assertEqual([actor['id'] for actor in self.history()['actors']], ['admin', 'gerente_vendas', 'organizador'])
        for role in ['membro', 'membro_vendas', 'trainee']:
            with self.subTest(role=role):
                self.assertEqual(self.request('GET', '/api/audit', role=role)[0], 403)
        self.assertEqual(self.request('GET', '/api/audit', role=None)[0], 401)

    def test_filters_and_pagination(self):
        self.seed_axes()
        self.create('materials', {'name': 'Guia', 'type': 'trainee', 'eixo': 'trainee'})
        everything = self.history()
        self.assertEqual(everything['total'], 7)
        # Mais recente primeiro.
        self.assertEqual(everything['items'][0]['action'], 'material.create')
        self.assertTrue(everything['items'][0]['created_at'].endswith('Z'))
        stamps = [item['created_at'] for item in everything['items']]
        self.assertEqual(stamps, sorted(stamps, reverse=True))

        self.assertEqual(self.history('?actor_id=organizador')['total'], 1)
        self.assertEqual(self.history('?action=user.create')['total'], 1)
        self.assertEqual(self.history('?entity_type=activity')['total'], 5)
        self.assertEqual(self.history('?entity_type=activity&actor_id=admin')['total'], 4)
        # Os atores do filtro não dependem dos demais filtros.
        self.assertEqual(len(self.history('?actor_id=organizador')['actors']), 3)

        page = self.history('?limit=3&offset=0')
        rest = self.history('?limit=3&offset=6')
        self.assertEqual((len(page['items']), page['total'], len(rest['items'])), (3, 7, 1))
        self.assertEqual([item['id'] for item in page['items']], [item['id'] for item in everything['items'][:3]])
        for query in ['?limit=0', '?limit=201', '?offset=-1', '?date_from=ontem']:
            with self.subTest(query=query):
                self.assertEqual(self.request('GET', f'/api/audit{query}')[0], 422)

        # Datas inclusivas, em dias UTC.
        with self.api.sessions() as db:
            rows = db.query(models.AuditLog).filter(models.AuditLog.action == 'user.create').all()
            rows[0].created_at = datetime(2030, 5, 10, 23, 59, tzinfo=timezone.utc)
            material = db.query(models.AuditLog).filter(models.AuditLog.action == 'material.create').one()
            material.created_at = datetime(2030, 5, 11, 0, 0, tzinfo=timezone.utc)
            db.commit()
        self.assertEqual([item['action'] for item in self.history('?date_from=2030-05-10&date_to=2030-05-10')['items']],
                         ['user.create'])
        self.assertEqual([item['action'] for item in self.history('?date_from=2030-05-11')['items']], ['material.create'])
        self.assertEqual(self.history('?date_from=2030-05-10&date_to=2030-05-11')['total'], 2)
        self.assertEqual(self.history('?date_to=2030-05-09')['total'], 5)
        # Bahia (UTC-3): meia-noite UTC ainda pertence ao dia anterior no navegador.
        local_day = self.history('?date_from=2030-05-10&date_to=2030-05-10&utc_offset_minutes=180')
        self.assertEqual({item['action'] for item in local_day['items']}, {'user.create', 'material.create'})


if __name__ == '__main__':
    unittest.main()
