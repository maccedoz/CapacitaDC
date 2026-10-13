"""Meu perfil (nome, senha, foto), popup de troca de senha e sugestões dos trainees."""
import unittest

from fastapi.testclient import TestClient

import test_creation
from app import models
from app.api import auth, suggestions, users
from app.auth import create_access_token, get_password_hash

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 64
WEBP = b'RIFF\x00\x00\x00\x00WEBPVP8 ' + b'\x00' * 32


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(auth.router, prefix='/api/auth')
        self.api.app.include_router(users.router, prefix='/api/users')
        self.api.app.include_router(suggestions.router, prefix='/api/suggestions')
        with self.api.sessions() as db:
            db.add(models.User(id='trainee', name='Trainee', email='trainee@example.com', password_hash='unused',
                               cargo='Trainee', type='trainee'))
            db.add(models.User(id='outro', name='Outro membro', email='outro@example.com', password_hash='unused',
                               cargo='Membro', type='membro', eixo='vendas'))
            db.get(models.User, 'membro').password_hash = get_password_hash('senha-atual')
            db.commit()
        self.request = self.api.request
        self.client = TestClient(self.api.app)

    def tearDown(self):
        self.api.tearDown()

    def user(self, user_id):
        with self.api.sessions() as db:
            user = db.get(models.User, user_id)
            db.expunge(user)
            return user

    def headers(self, role=None, token=None):
        return {'Authorization': f"Bearer {token or create_access_token({'sub': role, 'sub_type': 'user_id'})}"}

    # -- nome e senha ----------------------------------------------------------

    def test_everyone_edits_only_their_own_name(self):
        status, body = self.request('PATCH', '/api/auth/me', {'name': '  Novo Nome  '}, role='membro')
        self.assertEqual((status, body['name']), (200, 'Novo Nome'))
        self.assertEqual(self.request('PATCH', '/api/auth/me', {'name': '   '}, role='membro')[0], 422)
        # Outros campos do perfil não são aceitos por aqui.
        self.request('PATCH', '/api/auth/me', {'name': 'X', 'type': 'admin', 'eixo': 'conexoes'}, role='membro')
        self.assertEqual((self.user('membro').type, self.user('membro').eixo), ('membro', None))

    def test_changing_the_password_requires_the_current_one_and_ends_other_sessions(self):
        old_token = create_access_token({'sub': 'membro', 'sub_type': 'user_id'})
        status, body = self.request('POST', '/api/auth/me/password',
                                    {'current_password': 'errada', 'new_password': 'nova-senha'}, token=old_token)
        self.assertEqual((status, body['detail']), (400, 'A senha atual não confere.'))
        status, _ = self.request('POST', '/api/auth/me/password',
                                 {'current_password': 'senha-atual', 'new_password': '123'}, token=old_token)
        self.assertEqual(status, 422)
        status, body = self.request('POST', '/api/auth/me/password',
                                    {'current_password': 'senha-atual', 'new_password': 'nova-senha'}, token=old_token)
        self.assertEqual(status, 200, body)
        self.assertFalse(body['user']['password_prompt_pending'])
        # A sessão antiga cai; o token devolvido continua valendo.
        self.assertEqual(self.request('GET', '/api/auth/me', token=old_token)[0], 401)
        self.assertEqual(self.request('GET', '/api/auth/me', token=body['access_token'])[0], 200)
        self.assertEqual(self.request('POST', '/api/auth/login', {'email': 'membro@example.com', 'password': 'nova-senha'},
                                      role=None)[0], 200)

    def test_password_prompt_shows_until_dismissed_and_returns_after_a_staff_reset(self):
        status, body = self.request('GET', '/api/auth/me', role='membro')
        self.assertTrue(body['password_prompt_pending'])
        status, body = self.request('POST', '/api/auth/me/password-prompt/dismiss', role='membro')
        self.assertEqual((status, body['password_prompt_pending']), (200, False))
        self.assertEqual(self.request('PUT', '/api/users/membro', {'name': 'Membro'})[0], 200)
        self.assertFalse(self.user('membro').password_prompt_pending)
        self.assertEqual(self.request('PUT', '/api/users/membro', {'password': 'definida-pela-gestao'})[0], 200)
        self.assertTrue(self.user('membro').password_prompt_pending)

    # -- foto ----------------------------------------------------------------

    def upload(self, role, contents, name='foto.png'):
        return self.client.put('/api/auth/me/photo', files={'file': (name, contents, 'image/png')}, headers=self.headers(role))

    def test_photo_upload_is_checked_and_versioned(self):
        response = self.upload('membro', PNG)
        self.assertEqual(response.status_code, 200, response.text)
        first = response.json()['photo']
        self.assertTrue(first.startswith('/api/users/membro/photo?v='))
        second = self.upload('membro', WEBP, 'foto.webp').json()['photo']
        self.assertNotEqual(first, second)
        self.assertEqual(self.upload('membro', b'<svg onload=alert(1)>', 'foto.svg').status_code, 400)
        self.assertEqual(self.upload('membro', PNG + b'\x00' * (2 * 1024 * 1024)).status_code, 413)
        photo = self.client.get(second, headers=self.headers('membro'))
        self.assertEqual((photo.status_code, photo.headers['content-type'], photo.content), (200, 'image/webp', WEBP))
        self.assertIn('private', photo.headers['cache-control'])

    def test_photo_is_visible_to_its_owner_and_to_staff_who_manage_the_person(self):
        self.upload('membro', PNG)
        expected = {'membro': 200, 'admin': 200, 'organizador': 403, 'outro': 403, 'trainee': 403}
        for role, status in expected.items():
            with self.subTest(role=role):
                self.assertEqual(self.client.get('/api/users/membro/photo', headers=self.headers(role)).status_code, status)
        response = self.client.delete('/api/auth/me/photo', headers=self.headers('membro'))
        self.assertEqual((response.status_code, response.json()['photo']), (200, ''))
        self.assertEqual(self.client.get('/api/users/membro/photo', headers=self.headers('membro')).status_code, 404)

    def test_staff_cannot_set_a_photo_url_when_creating_people(self):
        status, body = self.request('POST', '/api/users', {
            'name': 'Novo', 'email': 'novo@example.com', 'cargo': 'trainee', 'type': 'trainee',
            'password': 'test-only', 'photo': 'https://evil.example/x.png'})
        self.assertEqual((status, body['photo']), (200, ''))

    # -- sugestões ---------------------------------------------------------------

    def test_trainees_send_named_suggestions_and_admins_and_organizers_read_them(self):
        status, created = self.request('POST', '/api/suggestions', {'text': '  Mais jogos de cenário  '}, role='trainee')
        self.assertEqual(status, 200, created)
        self.assertEqual((created['text'], created['author_name'], created['read_at']), ('Mais jogos de cenário', 'Trainee', None))
        self.assertTrue(created['created_at'].endswith('Z'))
        self.assertEqual(self.request('POST', '/api/suggestions', {'text': '   '}, role='trainee')[0], 422)
        self.assertEqual(self.request('POST', '/api/suggestions', {'text': 'x' * 2001}, role='trainee')[0], 422)
        for role in ['membro', 'admin', 'organizador']:
            self.assertEqual(self.request('POST', '/api/suggestions', {'text': 'Oi'}, role=role)[0], 403, role)
        for role, status in {'admin': 200, 'organizador': 200, 'membro': 403, 'trainee': 403}.items():
            with self.subTest(role=role):
                self.assertEqual(self.request('GET', '/api/suggestions', role=role)[0], status)
        _, mine = self.request('GET', '/api/suggestions/mine', role='trainee')
        self.assertEqual([item['id'] for item in mine], [created['id']])

    def test_marking_as_read_keeps_unread_first(self):
        _, first = self.request('POST', '/api/suggestions', {'text': 'Primeira'}, role='trainee')
        _, second = self.request('POST', '/api/suggestions', {'text': 'Segunda'}, role='trainee')
        status, read = self.request('PATCH', f"/api/suggestions/{second['id']}", {'read': True}, role='organizador')
        self.assertEqual(status, 200)
        self.assertIsNotNone(read['read_at'])
        _, listing = self.request('GET', '/api/suggestions', role='admin')
        self.assertEqual([item['id'] for item in listing], [first['id'], second['id']])
        _, unread = self.request('PATCH', f"/api/suggestions/{second['id']}", {'read': False}, role='admin')
        self.assertIsNone(unread['read_at'])
        self.assertEqual(self.request('PATCH', f"/api/suggestions/{second['id']}", {'read': True}, role='trainee')[0], 403)
        self.assertEqual(self.request('PATCH', '/api/suggestions/nao-existe', {'read': True}, role='admin')[0], 404)
