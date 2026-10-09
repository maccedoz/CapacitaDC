"""Conquistas novas, cronologia das tentativas e confirmação dos avisos."""
import unittest
from datetime import datetime, timezone

from sqlalchemy import inspect, text

import test_gamification
from app import models
from app.migrations import migrate


class AchievementTests(unittest.TestCase):
    def setUp(self):
        self.base = test_gamification.GamificationTests()
        self.base.setUp()
        self.api = self.base.api
        self.request, self.create = self.api.request, self.api.create

    def tearDown(self):
        self.base.tearDown()

    def entries(self):
        return {entry['id']: entry for entry in self.base.summary()['achievements']}

    def test_names_and_no_extra_points_from_achievements(self):
        entries = self.entries()
        self.assertEqual([entry['title'] for entry in entries.values()], [
            'Hello, World!', 'Farmou Aura', 'Brasileiro não desiste nunca', 'C de uma equação', 'Zerou o game',
            'Hat-trick', 'Nem precisou de Ctrl+Z', 'No meio do caminho tinha uma pedra',
            'Mochileiro dos eixos', 'Avatar: mestre dos três eixos',
        ])
        node = self.base.game()
        self.base.play(node, True)
        self.assertEqual(self.base.summary()['points'], 100)

    def test_persistent_needs_a_failure_before_a_success(self):
        node = self.base.game()
        self.base.play(node, True)
        self.base.play(node, False)
        self.assertFalse(self.entries()['persistent']['earned'])
        self.base.play(node, True)
        self.assertTrue(self.entries()['persistent']['earned'])

    def test_perfect_games_and_first_try_count_distinct_games(self):
        first = self.base.game()
        self.base.play(first, True)
        for _ in range(3):
            self.base.play(first, True)
        # O mesmo jogo em outro nó não vale como outro jogo.
        duplicate = self.create('nodes', {'type': 'game', 'eixo': 'vendas', 'game_revision_id': first['game_revision_id'],
                                          'is_released': True, 'is_required': False})
        self.base.play(duplicate, True)
        entries = self.entries()
        self.assertEqual(entries['hat_trick']['progress'], {'current': 1, 'target': 3})
        self.assertEqual(entries['first_try']['progress'], {'current': 1, 'target': 5})
        for _ in range(4):
            self.base.play(self.base.game(), True)
        entries = self.entries()
        self.assertTrue(entries['hat_trick']['earned'])
        self.assertTrue(entries['first_try']['earned'])
        self.assertEqual(entries['first_try']['progress'], {'current': 5, 'target': 5})

    def test_a_better_retry_does_not_count_as_first_try(self):
        node = self.base.game()
        self.base.play(node, False)
        self.base.play(node, True)
        self.assertEqual(self.entries()['first_try']['progress']['current'], 0)
        self.assertEqual(self.entries()['hat_trick']['progress']['current'], 1)

    def test_halfway_rounds_up_and_excludes_optional_steps(self):
        nodes = [self.base.game() for _ in range(3)]
        optional = self.base.game(is_required=False, weight=0)
        # Completar uma opcional não conta para metade das três obrigatórias.
        with self.api.sessions() as db:
            db.add(models.UserNodeProgress(user_id='membro', node_id=optional['id'], completed=True, grade=10))
            db.add(models.UserNodeProgress(user_id='membro', node_id=nodes[0]['id'], completed=True, grade=10))
            db.commit()
        half = self.entries()['halfway']
        self.assertFalse(half['earned'])
        self.assertEqual(half['progress'], {'current': 1, 'target': 2})
        with self.api.sessions() as db:
            db.add(models.UserNodeProgress(user_id='membro', node_id=nodes[1]['id'], completed=True, grade=10))
            db.commit()
        self.assertTrue(self.entries()['halfway']['earned'])
        self.assertFalse(self.entries()['trail_complete']['earned'])

    def test_explorer_and_all_trails_require_three_nonempty_axes(self):
        with self.api.sessions() as db:
            for axis in ['vendas', 'conexoes']:
                db.add(models.TrainingNode(id=axis, type='material', name=axis, eixo=axis, is_released=True, is_required=True))
                db.add(models.UserNodeProgress(user_id='membro', node_id=axis, completed=True))
            db.commit()
        entries = self.entries()
        self.assertFalse(entries['explorer']['earned'])
        self.assertFalse(entries['all_trails']['earned'])
        self.assertEqual(entries['all_trails']['progress'], {'current': 2, 'target': 3})
        with self.api.sessions() as db:
            for node_id, required in [('xp-optional', False), ('xp-required', True)]:
                db.add(models.TrainingNode(id=node_id, type='material', name=node_id, eixo='experiencia', is_released=True,
                                          is_required=required))
            db.add(models.UserNodeProgress(user_id='membro', node_id='xp-optional', completed=True))
            db.commit()
        self.assertTrue(self.entries()['explorer']['earned'])
        self.assertFalse(self.entries()['all_trails']['earned'])
        with self.api.sessions() as db:
            db.add(models.UserNodeProgress(user_id='membro', node_id='xp-required', completed=True))
            db.commit()
        self.assertTrue(self.entries()['all_trails']['earned'])

    def test_existing_achievements_are_silent_and_new_ones_wait_for_confirmation(self):
        first = self.base.game()
        self.base.play(first, True)
        baseline = self.base.summary()
        self.assertTrue(any(entry['earned'] for entry in baseline['achievements']))
        self.assertEqual(baseline['new_achievements'], [])
        with self.api.sessions() as db:
            self.assertIn('first_step', db.get(models.MemberAchievementState, 'membro').seen_ids)
        # Outro jogo rende Persistente; o aviso permanece até a confirmação.
        second = self.base.game()
        self.base.play(second, False)
        self.base.play(second, True)
        pending = self.base.summary()['new_achievements']
        self.assertEqual([entry['id'] for entry in pending], ['persistent'])
        self.assertEqual(self.base.summary()['new_achievements'], pending)
        status, data = self.request('POST', '/api/gamification/seen', {'achievement_ids': ['persistent']}, role='membro')
        self.assertEqual(status, 200, data)
        self.assertEqual(data['new_achievements'], [])
        self.assertEqual(self.base.summary()['new_achievements'], [])
        # Confirmar novamente é idempotente.
        self.assertEqual(self.request('POST', '/api/gamification/seen', {'achievement_ids': ['persistent']}, role='membro')[0], 200)

    def test_confirming_some_does_not_hide_other_pending_achievements(self):
        self.base.summary()
        node = self.base.game()
        self.base.play(node, True)
        pending = {entry['id'] for entry in self.base.summary()['new_achievements']}
        self.assertGreater(len(pending), 1)
        status, result = self.request('POST', '/api/gamification/seen', {'achievement_ids': ['first_step']}, role='membro')
        self.assertEqual(status, 200, result)
        self.assertEqual({entry['id'] for entry in result['new_achievements']}, pending - {'first_step'})

    def test_confirmation_cannot_hide_unearned_achievements_or_other_users_state(self):
        for ids in [[], ['all_trails'], ['unknown'], ['first_step'] * 11]:
            with self.subTest(ids=ids):
                self.assertEqual(self.request('POST', '/api/gamification/seen', {'achievement_ids': ids}, role='membro')[0], 422)
        for role in ['admin', 'trainee', 'organizador']:
            self.assertEqual(self.request('POST', '/api/gamification/seen', {'achievement_ids': ['first_step']}, role=role)[0], 403)
        self.assertEqual(self.request('POST', '/api/gamification/seen', {'achievement_ids': ['first_step']}, role=None)[0], 401)
        with self.api.sessions() as db:
            self.assertEqual(db.query(models.MemberAchievementState).count(), 0)

    def test_migration_is_idempotent_and_keeps_notification_state(self):
        self.base.summary()
        migrate(self.api.engine)
        migrate(self.api.engine)
        self.assertIn('member_achievement_states', inspect(self.api.engine).get_table_names())
        with self.api.sessions() as db:
            self.assertEqual(db.execute(text('SELECT COUNT(*) FROM schema_migrations WHERE version = 11')).scalar_one(), 1)
            state = db.get(models.MemberAchievementState, 'membro')
            state.seen_ids = ['first_step']
            state.initialized_at = datetime(2030, 1, 1, tzinfo=timezone.utc)
            db.commit()
        migrate(self.api.engine)
        with self.api.sessions() as db:
            self.assertEqual(db.get(models.MemberAchievementState, 'membro').seen_ids, ['first_step'])
            db.delete(db.get(models.User, 'membro'))
            db.commit()
            self.assertIsNone(db.get(models.MemberAchievementState, 'membro'))
