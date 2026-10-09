"""Prazo único, definido pela etapa da trilha: entregas, anexos, listagens, jogos e migração 9."""
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import test_creation
import test_games
from app import models, schemas
from app.api import activities
from app.database import Base
from app.migrations import migrate
from app.services import blob_storage

PAST = datetime(2020, 1, 1, 12)
FUTURE = datetime(2099, 1, 1, 12)
CLOSED = 'Esta atividade está fechada e não aceita mais envios'


class ActivityDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            db.add(models.User(id='trainee', name='Trainee', email='trainee@example.com', password_hash='unused',
                               cargo='Trainee', type='trainee'))
            db.commit()
        self.token_patch = patch.object(blob_storage, 'client_upload_token', side_effect=lambda pathname, size: 'token')
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop()
        self.api.tearDown()

    def activity(self, deadline=None):
        activity = self.create('activities', {'title': 'Atividade', 'eixo': 'trainee', 'accepts_file': False})
        self.set_deadline(models.Activity, activity['id'], deadline)
        return activity

    def node(self, activity, deadline=None):
        node = self.create('nodes', {'type': 'activity', 'eixo': 'trainee', 'activity_id': activity['id'],
                                     'is_released': True, 'is_required': False})
        self.set_deadline(models.TrainingNode, node['id'], deadline)
        return node

    def set_deadline(self, model, row_id, deadline):
        with self.api.sessions() as db:
            db.get(model, row_id).deadline = deadline
            db.commit()

    def submit(self, activity, node=None):
        payload = {'comment': 'Entrega'}
        if node:
            payload['node_id'] = node['id']
        return self.request('POST', f"/api/activities/{activity['id']}/submit", payload, role='trainee')

    def upload_token(self, activity, node=None):
        with self.api.sessions() as db:
            return activities.create_attachment_upload_token(activity['id'], schemas.AttachmentUploadRequest(
                name='resposta.pdf', size=10, node_id=node['id'] if node else None), db, db.get(models.User, 'trainee'))

    def listed(self, activity, role='trainee'):
        _, listing = self.request('GET', '/api/activities', role=role)
        return next(item for item in listing if item['id'] == activity['id'])

    def test_delivery_through_a_node_closes_at_that_node_deadline(self):
        # O prazo antigo da atividade não vale mais quando ela está na trilha.
        activity = self.activity(deadline=FUTURE)
        node = self.node(activity, deadline=PAST)
        status, result = self.submit(activity, node)
        self.assertEqual((status, result['detail']), (400, CLOSED))
        with self.assertRaises(HTTPException) as caught:
            self.upload_token(activity, node)
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, CLOSED))
        with self.api.sessions() as db, self.assertRaises(HTTPException) as caught:
            activities.register_submission_attachment(activity['id'], schemas.AttachmentRegister(
                pathname='submissions/trainee/x.pdf', name='resposta.pdf', node_id=node['id']), db, db.get(models.User, 'trainee'))
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, CLOSED))

        # E o inverso: atividade vencida, etapa ainda no prazo.
        self.set_deadline(models.Activity, activity['id'], PAST)
        self.set_deadline(models.TrainingNode, node['id'], FUTURE)
        self.assertEqual(self.upload_token(activity, node)['token'], 'token')
        status, result = self.submit(activity, node)
        self.assertEqual(status, 200, result)

    def test_each_node_has_its_own_deadline_and_without_node_the_latest_counts(self):
        activity = self.activity()
        closed = self.node(activity, deadline=PAST)
        open_node = self.node(activity, deadline=FUTURE)
        self.assertEqual(self.submit(activity, closed)[0], 400)
        # Sem etapa informada (aba Atividades), vale o prazo mais tardio.
        self.assertEqual(self.upload_token(activity)['token'], 'token')
        status, result = self.submit(activity)
        self.assertEqual(status, 200, result)
        status, result = self.submit(activity, open_node)
        self.assertEqual(status, 200, result)
        listed = self.listed(activity)
        self.assertEqual((listed['deadline'], listed['deadline_from_trail'], listed['effective_open']),
                         ('2099-01-01T12:00:00Z', True, True))
        # Pela etapa vencida, o conteúdo mostra o prazo dela e a entrega fechada.
        _, content = self.request('GET', f"/api/nodes/{closed['id']}/content", role='trainee')
        self.assertEqual((content['activity']['deadline'], content['activity']['effective_open']),
                         ('2020-01-01T12:00:00Z', False))
        _, content = self.request('GET', f"/api/nodes/{open_node['id']}/content", role='trainee')
        self.assertEqual((content['activity']['deadline'], content['activity']['effective_open']),
                         ('2099-01-01T12:00:00Z', True))

        self.set_deadline(models.TrainingNode, open_node['id'], PAST + timedelta(days=1))
        status, result = self.submit(activity)
        self.assertEqual((status, result['detail']), (400, CLOSED))
        listed = self.listed(activity, role='admin')
        self.assertEqual((listed['deadline'], listed['effective_open']), ('2020-01-02T12:00:00Z', False))

    def test_a_linked_node_without_deadline_leaves_the_activity_open(self):
        activity = self.activity(deadline=PAST)
        self.node(activity, deadline=PAST)
        self.node(activity)
        listed = self.listed(activity, role='admin')
        self.assertEqual((listed['deadline'], listed['deadline_from_trail'], listed['effective_open']), (None, True, True))
        status, result = self.submit(activity)
        self.assertEqual(status, 200, result)

    def test_activity_outside_the_trail_keeps_its_own_deadline(self):
        activity = self.activity(deadline=PAST)
        listed = self.listed(activity)
        self.assertEqual((listed['deadline'], listed['deadline_from_trail'], listed['effective_open']),
                         ('2020-01-01T12:00:00Z', False, False))
        self.assertEqual(self.submit(activity)[0], 400)
        with self.assertRaises(HTTPException):
            self.upload_token(activity)
        self.set_deadline(models.Activity, activity['id'], FUTURE)
        status, result = self.submit(activity)
        self.assertEqual(status, 200, result)
        status, updated = self.request('PATCH', f"/api/activities/{activity['id']}", {'title': 'Renomeada'})
        self.assertEqual((status, updated['deadline'], updated['deadline_from_trail']), (200, '2099-01-01T12:00:00Z', False))

    def test_manual_close_still_closes_before_the_node_deadline(self):
        activity = self.activity()
        node = self.node(activity, deadline=FUTURE)
        status, updated = self.request('PATCH', f"/api/activities/{activity['id']}", {'is_open': False})
        self.assertEqual((status, updated['effective_open'], updated['deadline_from_trail']), (200, False, True))
        self.assertEqual(self.submit(activity, node)[0], 400)
        self.assertEqual(self.submit(activity)[0], 400)
        self.assertFalse(self.listed(activity)['effective_open'])

    def test_legacy_node_linked_by_reference_id_defines_the_deadline(self):
        activity = self.activity(deadline=PAST)
        node = self.node(activity, deadline=FUTURE)
        with self.api.sessions() as db:
            row = db.get(models.TrainingNode, node['id'])
            row.activity_id, row.reference_id = None, activity['id']
            db.commit()
        listed = self.listed(activity, role='admin')
        self.assertEqual((listed['deadline'], listed['deadline_from_trail'], listed['effective_open']),
                         ('2099-01-01T12:00:00Z', True, True))


class GameDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.games = test_games.GameTests()
        self.games.setUp()
        self.request = self.games.request

    def tearDown(self):
        self.games.tearDown()

    def expire(self, node):
        with self.games.api.sessions() as db:
            db.get(models.TrainingNode, node['id']).deadline = PAST
            db.commit()

    def assert_expired(self, response):
        status, body = response
        self.assertEqual((status, body['detail']), (400, 'O prazo desta etapa terminou.'))

    def test_no_new_attempt_nor_completion_after_the_node_deadline(self):
        node = self.games.node()
        first = self.games.begin(node)
        status, result = self.games.complete(first, correct=False)
        self.assertEqual(status, 200, result)
        best = result['result']['best_grade']
        retry = self.games.begin(node)
        self.expire(node)
        # Nem a tentativa já aberta conclui, nem uma nova começa.
        self.assert_expired(self.games.complete(retry))
        self.assert_expired(self.request('POST', f"/api/nodes/{node['id']}/attempts", {}, role='membro'))
        # A tentativa concluída continua legível e a melhor nota fica.
        status, read = self.request('GET', f"/api/game-attempts/{first['id']}", role='membro')
        self.assertEqual((status, read['result']['best_grade']), (200, best))
        with self.games.api.sessions() as db:
            progress = db.query(models.UserNodeProgress).filter_by(user_id='membro', node_id=node['id']).one()
            self.assertEqual(progress.grade, best)
        # Repetir a conclusão já aceita só devolve o resultado.
        self.assertEqual(self.games.complete(first)[0], 200)

    def test_single_attempt_game_still_shows_its_result_after_the_deadline(self):
        node = self.games.node(allow_retry=False)
        attempt = self.games.begin(node)
        self.assertEqual(self.games.complete(attempt)[0], 200)
        self.expire(node)
        status, shown = self.request('POST', f"/api/nodes/{node['id']}/attempts", {}, role='membro')
        self.assertEqual((status, shown['id'], shown['status']), (200, attempt['id'], 'completed'))

    def test_scenario_decisions_stop_at_the_deadline(self):
        node = self.games.node(self.games.game(format='scenario'))
        attempt = self.games.begin(node)
        self.expire(node)
        self.assert_expired(self.request('POST', f"/api/game-attempts/{attempt['id']}/answers",
                                         {'step_id': 's1', 'option_id': 'b'}, role='membro'))

    def test_legacy_quiz_closes_at_the_deadline(self):
        node = self.games.create('nodes', {'name': 'Legado', 'type': 'game', 'eixo': 'vendas', 'is_released': True,
                                           'questions': [{'text': 'Pergunta', 'options': [
                                               {'text': 'A', 'score': 10, 'is_correct': True}, {'text': 'B', 'score': 0}]}]})
        answers = {'answers': [{'question_id': node['questions'][0]['id'],
                                'option_id': node['questions'][0]['options'][0]['id']}]}
        path = f"/api/nodes/{node['id']}/submit-game"
        self.assertEqual(self.request('POST', path, answers, role='membro')[0], 200)
        self.expire(node)
        self.assert_expired(self.request('POST', path, answers, role='membro'))


class DeadlineMigrationTests(unittest.TestCase):
    def test_v9_copies_activity_deadlines_into_nodes_without_one(self):
        engine = create_engine('sqlite://')
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        own, inherited = datetime(2026, 6, 1, 12), datetime(2026, 5, 1, 12)
        with sessions() as db:
            db.add_all([models.Activity(id='a1', title='Com prazo', eixo='trainee', deadline=inherited),
                        models.Activity(id='a2', title='Sem prazo', eixo='trainee')])
            # id: tipo, atividade, referência antiga, prazo da etapa
            for index, (node_id, (kind, activity_id, reference_id, deadline)) in enumerate({
                'herda': ('activity', 'a1', None, None), 'propria': ('activity', 'a1', None, own),
                'legada': ('activity', None, 'a1', None), 'sem': ('activity', 'a2', None, None),
                'jogo': ('game', None, None, None),
            }.items()):
                db.add(models.TrainingNode(id=node_id, name=node_id, type=kind, eixo='trainee', order_index=index,
                                           activity_id=activity_id, reference_id=reference_id, deadline=deadline))
            db.commit()
        migrate(engine)
        with sessions() as db:
            # Rodar de novo não pode reaplicar a cópia sobre uma edição posterior.
            db.get(models.TrainingNode, 'herda').deadline = None
            db.commit()
        migrate(engine)
        with sessions() as db:
            deadlines = {node.id: node.deadline for node in db.query(models.TrainingNode).all()}
            self.assertEqual(deadlines, {'herda': None, 'propria': own, 'legada': inherited, 'sem': None, 'jogo': None})
            self.assertEqual(db.get(models.Activity, 'a1').deadline, inherited)
        with engine.connect() as db:
            self.assertEqual(sorted(db.execute(text("SELECT id, deadline IS NULL FROM activity_deadline_backup_v9")).all()),
                             [('a1', 0), ('a2', 1)])
            self.assertEqual(db.execute(text("SELECT COUNT(*) FROM schema_migrations WHERE version = 9")).scalar_one(), 1)
            self.assertEqual(db.execute(text("SELECT COUNT(*) FROM schema_migrations WHERE version = 8")).scalar_one(), 1)
        engine.dispose()


if __name__ == '__main__':
    unittest.main()
