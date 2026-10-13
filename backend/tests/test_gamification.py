"""Member-only points, levels, achievements and ranking derived from grades."""
import unittest
from datetime import datetime, timezone

import test_creation
from app import models
from app.api import gamification, games
from app.services.gamification import level_for


class GamificationTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(games.router, prefix='/api')
        self.api.app.include_router(gamification.router, prefix='/api/gamification')
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            db.get(models.User, 'membro').eixo = 'Vendas'  # Display name, as older records store it.
            db.add_all([
                models.User(id='colega', name='Colega', email='colega@example.com', type='membro', cargo='Membro',
                            eixo='conexoes', password_hash='unused'),
                models.User(id='trainee', name='Trainee', email='trainee@example.com', type='trainee', cargo='Trainee',
                            password_hash='unused'),
            ])
            db.commit()

    def tearDown(self):
        self.api.tearDown()

    def game(self, **settings):
        game = self.create('games', {'title': 'Quiz', 'eixo': 'vendas', 'format': 'quiz', 'config': {'questions': [
            {'id': 'q', 'text': 'Pergunta', 'options': [{'id': 'yes', 'text': 'Certa', 'is_correct': True}, {'id': 'no', 'text': 'Errada'}]}]}})
        status, game = self.request('POST', f"/api/games/{game['id']}/publish", {})
        self.assertEqual(status, 200, game)
        return self.create('nodes', {'type': 'game', 'eixo': 'vendas', 'game_revision_id': game['published_revision']['id'],
                                     'is_released': True, **settings})

    def play(self, node, correct):
        status, attempt = self.request('POST', f"/api/nodes/{node['id']}/attempts", {}, role='membro')
        self.assertEqual(status, 200, attempt)
        status, result = self.request('POST', f"/api/game-attempts/{attempt['id']}/complete", {
            'answers': [{'question_id': 'q', 'option_ids': ['yes' if correct else 'no']}]}, role='membro')
        self.assertEqual(status, 200, result)

    def grade_delivery(self, user_id, grade, previous=None):
        activity = self.create('activities', {'title': f'Entrega {grade}', 'eixo': 'vendas', 'accepts_file': False})
        with self.api.sessions() as db:
            db.add(models.ActivitySubmission(activity_id=activity['id'], user_id=user_id, comment='Entrega',
                                             submitted_at=datetime.now(timezone.utc), grade=grade, previous_grade=previous))
            db.commit()

    def summary(self, role='membro'):
        status, result = self.request('GET', '/api/gamification', role=role)
        self.assertEqual(status, 200, result)
        return result

    def test_only_members_can_see_gamification(self):
        for role in ['trainee', 'admin', 'organizador']:
            with self.subTest(role=role):
                status, result = self.request('GET', '/api/gamification', role=role)
                self.assertEqual(status, 403, result)
                self.assertIn('exclusiva para membros', result['detail'])
        self.assertEqual(self.request('GET', '/api/gamification', role=None)[0], 401)

    def test_points_come_from_grades_and_define_level_and_ranking(self):
        empty = self.summary()
        self.assertEqual((empty['points'], empty['level']['number'], empty['level']['name']), (0, 1, 'Iniciante'))
        self.assertEqual([row['position'] for row in empty['ranking']], [1, 1])
        node = self.game()
        self.play(node, correct=False)  # Below the minimum: 0 points so far, step still open.
        self.play(node, correct=True)   # Best grade 10 → 100 points.
        self.grade_delivery('membro', 5, previous=8)  # Best delivery grade 8 → 80 points.
        self.grade_delivery('membro', None)          # Not corrected yet: no points.
        self.grade_delivery('colega', 9.5)
        self.grade_delivery('colega', 8.5)
        result = self.summary()
        self.assertEqual(result['points'], 180)
        self.assertEqual(result['level'], {'number': 2, 'name': 'Aprendiz', 'min_points': 100, 'next_points': 250})
        self.assertEqual(result['eixo'], 'vendas')
        self.assertEqual([(row['name'], row['points'], row['position'], row['is_me'], row['eixo']) for row in result['ranking']],
                         [('Colega', 180, 1, False, 'conexoes'), ('membro', 180, 1, True, 'vendas')])
        self.grade_delivery('colega', 1)
        self.assertEqual([(row['name'], row['position']) for row in self.summary()['ranking']],
                         [('Colega', 1), ('membro', 2)])
        # Trainees never appear in the members' ranking.
        self.assertNotIn('Trainee', [row['name'] for row in result['ranking']])

    def test_achievements_follow_progress(self):
        first, second = self.game(), self.game(allow_retry=False)
        earned = lambda: {item['id']: item['earned'] for item in self.summary()['achievements']}
        self.assertEqual(earned(), dict.fromkeys(['first_step', 'perfect_grade', 'persistent', 'consistent', 'trail_complete',
                                                 'hat_trick', 'first_try', 'halfway', 'explorer', 'all_trails'], False))
        self.play(first, correct=False)
        self.assertFalse(earned()['first_step'])  # A failed repeatable game does not conclude the step.
        self.play(first, correct=True)
        self.assertEqual({key for key, value in earned().items() if value}, {'first_step', 'perfect_grade', 'persistent', 'halfway'})
        self.play(second, correct=False)  # Single attempt: concluded with any grade.
        achievements = {item['id']: item for item in self.summary()['achievements']}
        self.assertTrue(achievements['trail_complete']['earned'])
        self.assertEqual(achievements['trail_complete']['progress'], {'current': 2, 'target': 2})
        self.assertEqual(achievements['consistent']['progress'], {'current': 1, 'target': 5})
        for grade in [7, 8, 9, 10]:
            self.grade_delivery('membro', grade)
        self.assertTrue(earned()['consistent'])

    def test_level_thresholds(self):
        for points, number in [(0, 1), (99, 1), (100, 2), (249, 2), (250, 3), (1399, 6), (1400, 7), (99999, 7)]:
            with self.subTest(points=points):
                self.assertEqual(level_for(points)['number'], number)
        self.assertIsNone(level_for(1400)['next_points'])


if __name__ == '__main__':
    unittest.main()
