"""Métricas do painel: público da trilha, primeira tentativa e isolamento por eixo."""
import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

import test_gamification
from app import models
from app.api import dashboard


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.base = test_gamification.GamificationTests()
        self.base.setUp()
        self.api = self.base.api
        self.api.app.include_router(dashboard.router, prefix='/api/dashboard')
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            for user_id, kind, axis in [('gerente_vendas', 'gerente', 'vendas'), ('broken_manager', 'gerente', None),
                                        ('member2', 'membro', 'vendas')]:
                db.add(models.User(id=user_id, name=user_id, email=f'{user_id}@example.com', type=kind,
                                   cargo=kind, eixo=axis, password_hash='unused'))
            db.commit()

    def tearDown(self):
        self.base.tearDown()

    def overview(self, trail='vendas', role='admin'):
        status, data = self.request('GET', f'/api/dashboard?trail={trail}', role=role)
        self.assertEqual(status, 200, data)
        return data

    def questions(self, node, role='admin'):
        status, data = self.request('GET', f"/api/dashboard/games/{node['id']}", role=role)
        self.assertEqual(status, 200, data)
        return data

    def test_completion_and_best_grades_only_count_the_trail_audience(self):
        node = self.base.game(name='Jogo A')
        future = self.base.game(name='Agendado')
        self.assertEqual(self.request('PATCH', f"/api/nodes/{future['id']}/release", {
            'is_released': True, 'released_at': '2099-01-01T00:00:00Z'})[0], 200)
        hidden = self.base.game(name='Bloqueado', is_released=False)
        with self.api.sessions() as db:
            for user_id, value in [('membro', 8), ('member2', 2), ('colega', 10)]:
                db.add(models.UserNodeProgress(user_id=user_id, node_id=node['id'], grade=value,
                                               completed=value >= 7))
            db.commit()
        data = self.overview()
        self.assertEqual(data['participants'], 2)
        self.assertEqual([(row['name'], row['completed'], row['total'], row['rate']) for row in data['steps']],
                         [('Jogo A', 1, 2, 0.5)])
        game = next(row for row in data['games'] if row['node_id'] == node['id'])
        self.assertEqual((game['average'], game['played'], game['approved_rate']), (5, 2, 0.5))
        self.assertEqual([row['node_id'] for row in data['games']][0], node['id'])
        self.assertEqual({row['node_id'] for row in data['games'][1:]}, {future['id'], hidden['id']})
        self.assertIsNone(data['games'][1]['average'])

    def test_empty_trail_and_legacy_games(self):
        node = self.create('nodes', {'name': 'Antigo', 'type': 'game', 'eixo': 'experiencia', 'is_released': True,
                                     'questions': [{'text': 'Pergunta', 'options': [
                                         {'text': 'Certa', 'is_correct': True, 'score': 1}, {'text': 'Errada'}]}]})
        data = self.overview('experiencia')
        self.assertEqual(data['participants'], 0)
        self.assertIsNone(data['steps'][0]['rate'])
        self.assertFalse(data['games'][0]['per_question'])
        self.assertEqual(self.questions(node), {'node_id': node['id'], 'name': 'Antigo', 'available': False, 'revisions': []})
        self.assertEqual(self.overview('trainee')['participants'], 1)

    def test_first_attempt_ignores_retries_and_foreign_members(self):
        node = self.base.game()
        self.base.play(node, correct=False)
        self.base.play(node, correct=True)
        with self.api.sessions() as db:
            revision = db.get(models.TrainingNode, node['id']).game_revision_id
            for user_id in ['member2', 'colega']:
                db.add(models.GameAttempt(user_id=user_id, node_id=node['id'], game_revision_id=revision,
                                          status='completed', started_at=datetime.now(timezone.utc),
                                          completed_at=datetime.now(timezone.utc), result={
                                              'grade': 10, 'feedback': [{'question_id': 'q', 'text': 'Pergunta',
                                                                       'is_correct': True, 'score': 1, 'max_score': 1}]}))
            db.commit()
        stats = self.questions(node)['revisions'][0]
        self.assertEqual((stats['attempts'], stats['average_first_grade']), (2, 5))
        self.assertEqual(stats['items'], [{'id': 'q', 'text': 'Pergunta', 'answers': 2,
                                          'correct_rate': 0.5, 'score_rate': 0.5}])
        self.assertEqual(self.overview()['games'][0]['average'], 10)  # média usa a melhor nota

    def test_versions_partial_credit_and_scenario_choices(self):
        node = self.base.game()
        with self.api.sessions() as db:
            original = db.get(models.TrainingNode, node['id']).game_revision_id
            first = db.get(models.GameRevision, original)
            second = models.GameRevision(game_id=first.game_id, version=2, title='Versão nova',
                                         format='quiz', config=first.config, published_at=datetime.now(timezone.utc))
            db.add(second)
            db.flush()
            moment = datetime(2030, 1, 1, tzinfo=timezone.utc)
            for revision_id, delay, result in [(original, 0, {
                'attempt_score': 1, 'max_score': 2, 'feedback': [
                    {'question_id': 'q', 'text': 'Parcial', 'is_correct': False, 'score': 1, 'max_score': 2},
                ]}), (second.id, 1, {'grade': 10, 'feedback': [
                    {'step_id': 's', 'text': 'Decisão', 'score': 5, 'max_score': 5},
                    {'item_id': 'i', 'text': 'Item', 'is_correct': False, 'score': 0, 'max_score': 1},
                ]})]:
                db.add(models.GameAttempt(user_id='membro', node_id=node['id'], game_revision_id=revision_id,
                                          status='completed', started_at=moment + timedelta(days=delay),
                                          completed_at=moment + timedelta(days=delay), result=result))
            db.commit()
        stats = self.questions(node)['revisions']
        self.assertEqual([row['version'] for row in stats], [2, 1])
        self.assertEqual([row['id'] for row in stats[0]['items']], ['i', 's'])
        self.assertEqual(stats[0]['items'][1]['correct_rate'], 1)
        self.assertEqual(stats[1]['items'][0]['correct_rate'], 0)
        self.assertEqual(stats[1]['items'][0]['score_rate'], 0.5)
        self.assertEqual(stats[1]['average_first_grade'], 5)

    def test_permissions_apply_to_both_endpoints(self):
        node = self.base.game()
        self.assertEqual(self.overview(role='gerente_vendas')['trails'], ['trainee', 'vendas'])
        self.assertEqual(self.overview('trainee', role='organizador')['trails'], ['trainee'])
        for role in ['membro', 'trainee', 'broken_manager']:
            for path in ['/api/dashboard', f"/api/dashboard/games/{node['id']}"]:
                with self.subTest(role=role, path=path):
                    self.assertEqual(self.request('GET', path, role=role)[0], 403)
        self.assertEqual(self.request('GET', '/api/dashboard', role=None)[0], 401)
        self.assertEqual(self.request('GET', '/api/dashboard?trail=conexoes', role='gerente_vendas')[0], 403)
        self.assertEqual(self.request('GET', '/api/dashboard?trail=vendas', role='organizador')[0], 403)
        self.assertEqual(self.request('GET', '/api/dashboard?trail=invalido')[0], 422)
        self.assertEqual(self.request('GET', f"/api/dashboard/games/{node['id']}", role='organizador')[0], 403)
        self.assertEqual(self.request('GET', '/api/dashboard/games/missing')[0], 404)

    def test_query_count_does_not_grow_with_steps_or_people(self):
        def count():
            queries = []
            def capture(_connection, _cursor, statement, _parameters, _context, _many):
                if statement.lstrip().upper().startswith('SELECT'):
                    queries.append(statement)
            event.listen(self.api.engine, 'before_cursor_execute', capture)
            try:
                self.overview()
            finally:
                event.remove(self.api.engine, 'before_cursor_execute', capture)
            return len(queries)
        node = self.base.game()
        activity = self.create('activities', {'title': 'Entrega', 'eixo': 'vendas', 'accepts_file': False})
        self.create('nodes', {'name': 'Entrega', 'type': 'activity', 'eixo': 'vendas', 'activity_id': activity['id'], 'is_released': True})
        before = count()
        with self.api.sessions() as db:
            for index in range(12):
                user = models.User(id=f'extra-{index}', name='Outro', email=f'extra-{index}@example.com',
                                   password_hash='unused', type='membro', cargo='Membro', eixo='vendas')
                db.add(user)
                db.add(models.TrainingNode(id=f'node-{index}', name='Etapa', type='game', eixo='vendas',
                                          game_revision_id=node['game_revision_id'], order_index=index + 1, is_released=True))
                db.add(models.UserNodeProgress(user_id=user.id, node_id=f'node-{index}', grade=8, completed=True))
                db.add(models.Activity(id=f'activity-{index}', title='Outra entrega', eixo='vendas', accepts_file=False,
                                       created_at=datetime.now(timezone.utc)))
                db.add(models.TrainingNode(id=f'activity-node-{index}', name='Entrega', type='activity', eixo='vendas',
                                          activity_id=f'activity-{index}', is_released=True, order_index=index + 20))
            db.commit()
        self.assertEqual(count(), before)
        self.assertLessEqual(before, 5)
