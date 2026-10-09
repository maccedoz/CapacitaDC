"""Regression tests for sessions, content permissions and activity delivery."""
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import test_creation
from app import models
from app.api import auth, users
from app.auth import create_access_token


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(auth.router, prefix='/api/auth')
        self.api.app.include_router(users.router, prefix='/api/users')
        with self.api.sessions() as db:
            db.add(models.User(id='trainee', name='Trainee', email='trainee@example.com', password_hash='unused', cargo='Trainee', type='trainee'))
            db.commit()
        self.request = self.api.request
        self.create = self.api.create

    def tearDown(self):
        self.api.tearDown()

    def test_there_is_no_public_registration(self):
        status, _ = self.request('POST', '/api/auth/register', {
            'name': 'Cadastro público', 'email': 'novo@example.com', 'cargo': 'Administrador', 'password': 'test-only',
        }, role=None)
        self.assertEqual(status, 404)
        with self.api.sessions() as db:
            self.assertIsNone(db.query(models.User).filter(models.User.email == 'novo@example.com').first())

    def login(self, email, password):
        return self.request('POST', '/api/auth/login', {'email': email, 'password': password}, role=None)

    def test_five_wrong_passwords_lock_the_login_for_fifteen_minutes(self):
        with self.api.sessions() as db:
            db.get(models.User, 'membro').password_hash = auth.get_password_hash('senha-certa')
            db.commit()
        for attempt in range(4):
            status, result = self.login('membro@example.com', 'errada')
            self.assertEqual(status, 400, (attempt, result))
        status, result = self.login('membro@example.com', 'errada')
        self.assertEqual(status, 429, result)
        self.assertIn('15 minutos', result['detail'])
        # Bloqueado, nem a senha certa entra.
        status, result = self.login('membro@example.com', 'senha-certa')
        self.assertEqual(status, 429, result)
        with self.api.sessions() as db:
            user = db.get(models.User, 'membro')
            self.assertEqual(user.failed_login_attempts, 0)
            user.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        status, result = self.login('membro@example.com', 'senha-certa')
        self.assertEqual(status, 200, result)
        with self.api.sessions() as db:
            user = db.get(models.User, 'membro')
            self.assertEqual((user.failed_login_attempts, user.locked_until), (0, None))

    def test_successful_login_resets_the_failure_count(self):
        with self.api.sessions() as db:
            db.get(models.User, 'membro').password_hash = auth.get_password_hash('senha-certa')
            db.commit()
        for _ in range(4):
            self.login('membro@example.com', 'errada')
        self.assertEqual(self.login('membro@example.com', 'senha-certa')[0], 200)
        for _ in range(4):
            self.assertEqual(self.login('membro@example.com', 'errada')[0], 400)

    def test_unknown_email_gets_the_same_answer_as_a_wrong_password(self):
        with patch.object(auth, 'verify_password', wraps=auth.verify_password) as verify:
            status, result = self.login('ninguem@example.com', 'qualquer')
        self.assertEqual((status, result['detail']), (400, 'Email ou senha incorretos'))
        # A senha é conferida contra um hash fictício, para o tempo de resposta não denunciar o e-mail.
        verify.assert_called_once()

    def test_passwords_need_six_characters_and_are_required_on_creation(self):
        base = {'name': 'Novo', 'email': 'novo@example.com', 'cargo': 'Trainee', 'type': 'trainee'}
        self.assertEqual(self.request('POST', '/api/users', base)[0], 422)
        self.assertEqual(self.request('POST', '/api/users', {**base, 'password': '12345'})[0], 422)
        status, created = self.request('POST', '/api/users', {**base, 'password': '123456'})
        self.assertEqual(status, 200, created)
        path = f"/api/users/{created['id']}"
        self.assertEqual(self.request('PUT', path, {'password': 'curta'})[0], 422)
        # Vazio mantém a senha atual, como no formulário de edição.
        self.assertEqual(self.request('PUT', path, {'name': 'Renomeado', 'password': ''})[0], 200)
        self.assertEqual(self.request('PUT', path, {'password': 'nova-senha'})[0], 200)

    def test_login_token_survives_email_change_and_legacy_token_works(self):
        with patch.object(auth, 'verify_password', return_value=True):
            status, result = self.request('POST', '/api/auth/login', {'email': 'admin@example.com', 'password': 'test-only'}, role=None)
        self.assertEqual(status, 200)
        token = result['access_token']
        status, result = self.request('PUT', '/api/users/admin', {'email': 'changed@example.com'}, role=None, token=token)
        self.assertEqual(status, 200)
        status, result = self.request('GET', '/api/auth/me', role=None, token=token)
        self.assertEqual(status, 200)
        self.assertEqual(result['email'], 'changed@example.com')
        legacy = create_access_token({'sub': 'membro@example.com'})
        status, result = self.request('GET', '/api/auth/me', role=None, token=legacy)
        self.assertEqual(status, 200)
        self.assertEqual(result['id'], 'membro')

    def test_organizer_and_trainee_cannot_act_outside_their_content(self):
        activity = self.create('activities', {'title': 'Restrita', 'eixo': 'vendas'})
        for method, path, body, role in [
            ('POST', '/api/activities', {'title': 'Restrita', 'eixo': 'vendas'}, 'organizador'),
            ('PATCH', f"/api/activities/{activity['id']}", {'title': 'Alterada'}, 'organizador'),
            ('GET', f"/api/activities/{activity['id']}/submissions", None, 'organizador'),
            ('DELETE', f"/api/activities/{activity['id']}", None, 'organizador'),
            ('POST', f"/api/activities/{activity['id']}/submit", {'file_url': 'https://example.com/file'}, 'trainee'),
            ('GET', '/api/users/admin/profile', None, 'organizador'),
        ]:
            with self.subTest(method=method, path=path):
                status, result = self.request(method, path, body, role)
                self.assertEqual(status, 403, result)

    def test_patch_can_remove_deadline_and_material_without_clearing_omitted_fields(self):
        material = self.create('materials', {'name': 'Material', 'type': 'trainee', 'eixo': 'trainee'})
        activity = self.create('activities', {
            'title': 'Atividade', 'eixo': 'trainee', 'deadline': '2030-01-01T00:00:00Z', 'material_id': material['id'],
        })
        path = f"/api/activities/{activity['id']}"
        _, updated = self.request('PATCH', path, {'title': 'Alterada'})
        self.assertEqual(updated['deadline'], activity['deadline'])
        self.assertEqual(updated['material_id'], material['id'])
        status, updated = self.request('PATCH', path, {'deadline': None, 'material_id': None})
        self.assertEqual(status, 200)
        self.assertIsNone(updated['deadline'])
        self.assertIsNone(updated['material_id'])

    def test_activity_deadline_offsets_are_stored_as_the_same_utc_instant(self):
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'deadline': '2030-01-02T14:00:00-03:00'})
        self.assertEqual(activity['deadline'], '2030-01-02T17:00:00Z')
        path = f"/api/activities/{activity['id']}"
        for value in ['2030-01-02T17:30:00Z', '2030-01-02T14:30:00-03:00', '2030-01-02T23:00:00+05:30']:
            with self.subTest(value=value):
                status, updated = self.request('PATCH', path, {'deadline': value})
                self.assertEqual(status, 200, updated)
                self.assertEqual(updated['deadline'], '2030-01-02T17:30:00Z')
                with self.api.sessions() as db:
                    stored = db.get(models.Activity, activity['id']).deadline
                    self.assertEqual(stored, datetime(2030, 1, 2, 17, 30))
                    self.assertIsNone(stored.tzinfo)
                for role in ['admin', 'trainee']:
                    _, listing = self.request('GET', '/api/activities', role=role)
                    self.assertEqual(listing[0]['deadline'], updated['deadline'])
                # Saving the edit form without changes re-sends the returned value.
                status, repeated = self.request('PATCH', path, {'deadline': updated['deadline']})
                self.assertEqual(status, 200)
                self.assertEqual(repeated['deadline'], updated['deadline'])

    def test_activity_deadline_without_timezone_is_rejected(self):
        status, result = self.request('POST', '/api/activities', {
            'title': 'Atividade', 'eixo': 'trainee', 'deadline': '2030-01-02T14:00:00',
        })
        self.assertEqual(status, 422, result)
        self.assertEqual(result['detail'][0]['loc'], ['body', 'deadline'])
        self.assertIn('fuso horário', result['detail'][0]['msg'])
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'deadline': '2030-01-02T17:00:00Z'})
        for value in ['2030-01-03T14:00:00', '2030-01-03']:
            with self.subTest(value=value):
                status, result = self.request('PATCH', f"/api/activities/{activity['id']}", {'deadline': value})
                self.assertEqual(status, 422, result)
                self.assertEqual(result['detail'][0]['loc'], ['body', 'deadline'])
        with self.api.sessions() as db:
            self.assertEqual(db.query(models.Activity).count(), 1)
            self.assertEqual(db.get(models.Activity, activity['id']).deadline, datetime(2030, 1, 2, 17))

    def test_legacy_deadlines_are_explicit_utc_in_responses(self):
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'accepts_file': False})
        node = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'], 'is_released': True})
        with self.api.sessions() as db:
            db.get(models.Activity, activity['id']).deadline = datetime(2030, 1, 2, 17)
            db.get(models.TrainingNode, node['id']).deadline = datetime(2030, 1, 3, 17)
            db.commit()
        _, listing = self.request('GET', '/api/activities', role='trainee')
        self.assertEqual(listing[0]['deadline'], '2030-01-02T17:00:00Z')
        _, nodes = self.request('GET', '/api/nodes', role='trainee')
        self.assertEqual(nodes[0]['deadline'], '2030-01-03T17:00:00Z')
        status, content = self.request('GET', f"/api/nodes/{node['id']}/content", role='trainee')
        self.assertEqual(status, 200, content)
        self.assertEqual(content['node']['deadline'], '2030-01-03T17:00:00Z')
        self.assertEqual(content['activity']['deadline'], '2030-01-02T17:00:00Z')
        with self.api.sessions() as db:
            self.assertEqual(db.get(models.Activity, activity['id']).deadline, datetime(2030, 1, 2, 17))

    def test_submissions_close_at_the_deadline_instant(self):
        activity = self.create('activities', {
            'title': 'Atividade', 'eixo': 'trainee', 'accepts_file': False, 'deadline': '2030-01-02T14:00:00-03:00',
        })
        node = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'], 'is_released': True})
        deadline = datetime(2030, 1, 2, 17, tzinfo=timezone.utc)
        for delta, is_open in [(timedelta(microseconds=-1), True), (timedelta(), False), (timedelta(microseconds=1), False)]:
            with self.subTest(delta=delta), patch('app.services.activity_service.datetime') as clock:
                clock.now.return_value = deadline + delta
                _, listing = self.request('GET', '/api/activities', role='trainee')
                self.assertEqual(listing[0]['effective_open'], is_open)
                status, result = self.request('POST', f"/api/activities/{activity['id']}/submit",
                                              {'node_id': node['id'], 'comment': 'Entrega'}, role='trainee')
                self.assertEqual(status, 200 if is_open else 400, result)

    def test_delivery_completes_only_the_selected_available_node(self):
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'accepts_file': False})
        node = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'], 'is_released': True})
        blocked = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'], 'is_released': False})
        path = f"/api/activities/{activity['id']}/submit"
        status, _ = self.request('POST', path, {'node_id': blocked['id'], 'comment': 'Entrega'}, role='trainee')
        self.assertEqual(status, 403)
        status, _ = self.request('POST', path, {'node_id': node['id'], 'comment': ''}, role='trainee')
        self.assertEqual(status, 400)
        for _ in range(2):
            status, body = self.request('POST', path, {'node_id': node['id'], 'comment': 'Entrega'}, role='trainee')
            self.assertEqual(status, 200, body)
        with self.api.sessions() as db:
            progress = db.query(models.UserNodeProgress).all()
            self.assertEqual(len(progress), 1)
            self.assertEqual(progress[0].node_id, node['id'])
            self.assertTrue(progress[0].completed)
            self.assertEqual(db.query(models.ActivitySubmission).count(), 1)

    def test_activity_without_node_id_cannot_bypass_trail_gates(self):
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'accepts_file': False})
        self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id']})
        status, _ = self.request('POST', f"/api/activities/{activity['id']}/submit", {'comment': 'Entrega'}, role='trainee')
        self.assertEqual(status, 403)

    def test_retired_pluginfo_axis_is_rejected_and_organizer_is_limited_to_trainees(self):
        """PlugInfo é papel, não eixo: o valor não existe mais para nenhum perfil."""
        payloads = {
            'nodes': lambda eixo: {'type': 'game', 'eixo': eixo,
                                   'questions': [{'text': 'Pergunta', 'options': [
                                       {'text': 'A', 'score': 10, 'is_correct': True}, {'text': 'B', 'score': 0}]}]},
            'activities': lambda eixo: {'title': 'Atividade', 'eixo': eixo},
        }
        for resource, build in payloads.items():
            for role in ['admin', 'organizador']:
                with self.subTest(resource=resource, role=role):
                    status, _ = self.request('POST', f'/api/{resource}', build('pluginfo'), role=role)
                    self.assertEqual(status, 422)
            status, body = self.request('POST', f'/api/{resource}', build('vendas'), role='organizador')
            self.assertEqual(status, 403, body)
            status, body = self.request('POST', f'/api/{resource}', build('trainee'), role='organizador')
            self.assertEqual(status, 200, body)
        status, _ = self.request('POST', '/api/materials', {'name': 'Material', 'type': 'pluginfo', 'eixo': 'trainee'})
        self.assertEqual(status, 422)
        status, body = self.request('POST', '/api/materials', {'name': 'Material', 'type': 'trainee', 'eixo': 'trainee'}, role='organizador')
        self.assertEqual(status, 200, body)

    def test_material_cannot_use_retired_axis_with_valid_type(self):
        status, _ = self.request('POST', '/api/materials', {'name': 'Material', 'type': 'trainee', 'eixo': 'pluginfo'})
        self.assertEqual(status, 422)
