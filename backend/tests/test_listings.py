"""Planilha de notas, perfil e listagem de atividades: conteúdo fixado e consultas sem N+1."""
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import event

import test_creation
from app import models
from app.api import auth, grades, users

T = datetime(2026, 3, 1, 12, 0, 0)
PEOPLE = {
    'gerente_vendas': ('gerente', 'vendas', None), 'gerente_conexoes': ('gerente', 'Conexões', None),
    'membro_vendas': ('membro', 'Vendas', None), 'membro_conexoes': ('membro', 'conexoes', None),
    'membro_exp': ('membro', 'Experiência do Consumidor', None),
    'trainee1': ('trainee', None, 1), 'trainee2': ('trainee', None, 2),
}
# id: (eixo, peso, obrigatória, criada em)
ACTIVITIES = {
    'act_t': ('trainee', 2.0, True, T), 'act_t2': ('trainee', 1.0, True, T + timedelta(hours=1)),
    'act_v': ('vendas', 1.0, True, T + timedelta(hours=2)), 'act_all': ('all', 1.0, False, T + timedelta(hours=3)),
    'act_c': ('conexoes', 0.0, True, None),
}
# id, tipo, eixo, liberada, atividade, ordem
NODES = [
    ('n_m1', 'material', 'trainee', True, None, 0), ('n_a1', 'activity', 'trainee', True, 'act_t', 1),
    ('n_g1', 'game', 'trainee', True, None, 2), ('n_a2', 'activity', 'trainee', False, 'act_t2', 3),
    ('n_mv', 'material', 'vendas', True, None, 0), ('n_av', 'activity', 'vendas', True, 'act_v', 1),
    ('n_gv', 'game', 'vendas', True, None, 2), ('n_mc', 'material', 'conexoes', True, None, 0),
    ('n_all', 'material', 'all', True, None, 0),
]
# usuário, etapa, concluída, pontos, nota
PROGRESS = [
    ('trainee1', 'n_m1', True, 50, None), ('trainee1', 'n_a1', True, 0, None), ('trainee1', 'n_g1', True, 80, 7.0),
    ('trainee1', 'n_all', True, 50, None), ('trainee1', 'n_mv', True, 50, None),
    ('trainee2', 'n_m1', True, 50, None), ('trainee2', 'n_a1', False, 0, None),
    ('membro_vendas', 'n_mv', True, 50, None), ('membro_vendas', 'n_mc', True, 50, None),
    ('membro_vendas', 'n_gv', False, 30, 5.0), ('membro_vendas', 'n_av', True, 0, None),
    ('membro_conexoes', 'n_mc', True, 50, None), ('membro_conexoes', 'n_all', True, 50, None),
    ('membro', 'n_mv', True, 50, None),
]
# usuário, atividade, nota, nota anterior
SUBMISSIONS = [
    ('trainee1', 'act_t', 8.0, None), ('trainee1', 'act_all', None, None), ('trainee2', 'act_t', None, 6.0),
    ('membro_vendas', 'act_v', 9.0, None), ('membro_conexoes', 'act_v', None, None),
    ('membro_vendas', 'act_all', 4.0, None), ('membro_exp', 'act_c', 3.0, 5.0), ('trainee1', 'act_t2', 10.0, None),
]
ATTACHMENT = {'id': 'att1', 'name': 'a.pdf', 'size': 10, 'url': '/api/activities/act_t/attachments/att1'}


class ListingTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        for prefix, module in [('/api/auth', auth), ('/api/users', users)]:
            self.api.app.include_router(module.router, prefix=prefix)
        self.api.app.include_router(grades.router, prefix='/api')
        self.request = self.api.request
        with self.api.sessions() as db:
            for user_id, (kind, eixo, rotacao) in PEOPLE.items():
                db.add(models.User(id=user_id, name=user_id, email=f'{user_id}@example.com', password_hash='unused',
                                   cargo=kind, type=kind, eixo=eixo, rotacao=rotacao, pontos_acumulados=33,
                                   nota_rotacao=None if kind == 'gerente' else 7.5))
            for activity_id, (eixo, weight, required, created) in ACTIVITIES.items():
                db.add(models.Activity(id=activity_id, title=activity_id, eixo=eixo, weight=weight,
                                       is_required=required, created_at=created))
            for node_id, kind, eixo, released, activity_id, order in NODES:
                db.add(models.TrainingNode(id=node_id, name=node_id, type=kind, eixo=eixo, is_released=released,
                                           activity_id=activity_id, order_index=order,
                                           weight=2.0 if kind == 'game' else 1.0, is_required=node_id != 'n_gv'))
            for index, (user_id, node_id, done, score, grade) in enumerate(PROGRESS):
                db.add(models.UserNodeProgress(id=f'p{index:02d}', user_id=user_id, node_id=node_id, completed=done,
                                               score=score, grade=grade,
                                               completed_at=T + timedelta(minutes=index) if done else None))
            for index, (user_id, activity_id, grade, previous) in enumerate(SUBMISSIONS):
                db.add(models.ActivitySubmission(id=f's{index:02d}', user_id=user_id, activity_id=activity_id,
                                                 grade=grade, previous_grade=previous, comment='',
                                                 submitted_at=T + timedelta(hours=index)))
            db.add(models.SubmissionAttachment(id='att1', activity_id='act_t', user_id='trainee1', submission_id='s00',
                                               name='a.pdf', storage_key='k', size=10))
            db.commit()

    def tearDown(self):
        self.api.tearDown()

    def get(self, path, role):
        status, body = self.request('GET', path, role=role)
        self.assertEqual(status, 200, body)
        return body

    @contextmanager
    def count_queries(self):
        counter = [0]
        def count(*_):
            counter[0] += 1
        event.listen(self.api.engine, 'before_cursor_execute', count)
        try:
            yield counter
        finally:
            event.remove(self.api.engine, 'before_cursor_execute', count)

    def test_grades_rows(self):
        trainees = [('trainee1', 5, 4, 3, 2, 33, 7.5), ('trainee2', 1, 4, 1, 0, 33, 7.5)]
        # O numerador conta etapas concluídas de qualquer eixo; o denominador, só a trilha própria.
        expected = {
            'admin': [('membro', 1, 0, 0, 0, 0, None), ('membro_vendas', 3, 3, 2, 2, 33, 7.5),
                      ('membro_conexoes', 2, 1, 1, 0, 33, 7.5), ('membro_exp', 0, 0, 1, 1, 33, 7.5), *trainees],
            'organizador': trainees,
            'gerente_vendas': [('membro_vendas', 2, 3, 1, 1, 50, 9.0), *trainees],
            'gerente_conexoes': [('membro_conexoes', 1, 1, 0, 0, 50, None), *trainees],
        }
        fields = ['id', 'nodes_completed', 'nodes_total', 'activities_submitted', 'activities_graded',
                  'pontos_acumulados', 'nota_rotacao']
        for role, rows in expected.items():
            with self.subTest(role=role):
                body = self.get('/api/grades', role)
                self.assertEqual([tuple(row[field] for field in fields) for row in body], rows)
        row = next(item for item in self.get('/api/grades', 'admin') if item['id'] == 'membro_exp')
        self.assertEqual((row['name'], row['email'], row['cargo'], row['type'], row['eixo'], row['rotacao']),
                         ('membro_exp', 'membro_exp@example.com', 'membro', 'membro', 'Experiência do Consumidor', None))

    def test_activities_listing(self):
        expected = {
            'admin': [('act_all', 2, None), ('act_v', 2, None), ('act_t2', 1, None), ('act_t', 2, None),
                      ('act_c', 1, None)],
            'organizador': [('act_all', 2, None), ('act_t2', 1, None), ('act_t', 2, None)],
            'gerente_vendas': [('act_all', 2, None), ('act_v', 1, None), ('act_t2', 1, None), ('act_t', 2, None)],
            'gerente_conexoes': [('act_all', 1, None), ('act_t2', 1, None), ('act_t', 2, None), ('act_c', 0, None)],
            'membro': [('act_all', 2, None), ('act_v', 2, None), ('act_c', 1, None)],
            'membro_vendas': [('act_all', 2, 's05'), ('act_v', 2, 's03'), ('act_c', 1, None)],
            # act_t2 fica atrás de uma etapa fechada, mesmo com entrega.
            'trainee1': [('act_all', 2, 's01'), ('act_t', 2, 's00')],
            'trainee2': [('act_all', 2, None), ('act_t', 2, 's02')],
        }
        for role, rows in expected.items():
            with self.subTest(role=role):
                body = self.get('/api/activities', role)
                self.assertEqual([(item['id'], item['submission_count'], (item['my_submission'] or {}).get('id'))
                                  for item in body], rows)
        listing = {item['id']: item for item in self.get('/api/activities', 'trainee1')}
        mine = listing['act_t']['my_submission']
        self.assertEqual(listing['act_t']['created_at'], '2026-03-01T12:00:00')
        self.assertEqual((mine['submitted_at'], mine['grade'], mine['effective_grade'], mine['attachments'],
                          mine['user_name'], mine['activity_title'], mine['activity_weight']),
                         ('2026-03-01T12:00:00', 8.0, 8.0, [ATTACHMENT], 'trainee1', 'act_t', 2.0))

    def test_profile(self):
        profile = self.get('/api/users/trainee1/profile', 'admin')
        self.assertEqual([(item['node_id'], item['completed'], item['score'], item['grade'], item['weight'],
                           item['completed_at']) for item in profile['node_progress']], [
            ('n_a1', True, 0, None, 1.0, '2026-03-01T12:01:00'),
            ('n_all', True, 50, None, 1.0, '2026-03-01T12:03:00'),
            ('n_g1', True, 80, 7.0, 2.0, '2026-03-01T12:02:00'),
            ('n_m1', True, 50, None, 1.0, '2026-03-01T12:00:00'),
            ('n_mv', True, 50, None, 1.0, '2026-03-01T12:04:00'),
        ])
        self.assertEqual([(item['id'], item['submitted_at'], item['effective_grade'], item['attachments'])
                          for item in profile['activity_submissions']], [
            ('s00', '2026-03-01T12:00:00', 8.0, [ATTACHMENT]),
            ('s01', '2026-03-01T13:00:00', None, []),
            ('s07', '2026-03-01T19:00:00', 10.0, []),
        ])
        scoped = self.get('/api/users/membro_vendas/profile', 'gerente_vendas')
        self.assertEqual((scoped['pontos_acumulados'], scoped['nota_rotacao']), (50, 9.0))
        self.assertEqual([(item['node_id'], item['completed'], item['is_required'], item['completed_at'])
                          for item in scoped['node_progress']],
                         [('n_av', True, True, '2026-03-01T12:10:00'), ('n_gv', False, False, None),
                          ('n_mv', True, True, '2026-03-01T12:07:00')])
        self.assertEqual([item['id'] for item in scoped['activity_submissions']], ['s03'])

    def test_query_count_does_not_grow_with_rows(self):
        cases = [('/api/grades', 'admin'), ('/api/grades', 'organizador'), ('/api/grades', 'gerente_vendas'),
                 ('/api/activities', 'admin'), ('/api/activities', 'gerente_vendas'),
                 ('/api/activities', 'trainee1'), ('/api/activities', 'membro_vendas'),
                 ('/api/users/trainee1/profile', 'admin'), ('/api/users/membro_vendas/profile', 'gerente_vendas')]

        def measure():
            counts = {}
            for path, role in cases:
                with self.count_queries() as counter:
                    self.get(path, role)
                counts[path, role] = counter[0]
            return counts

        before = measure()
        with self.api.sessions() as db:
            for index in range(5):
                for kind, eixo in [('trainee', None), ('membro', 'vendas')]:
                    user_id = f'extra_{kind}_{index}'
                    db.add(models.User(id=user_id, name=user_id, email=f'{user_id}@example.com',
                                       password_hash='unused', cargo=kind, type=kind, eixo=eixo))
                    for activity_id in ['act_t', 'act_v', 'act_all']:
                        db.add(models.ActivitySubmission(id=f'{user_id}_{activity_id}', user_id=user_id,
                                                         activity_id=activity_id, grade=index))
                activity_id = f'extra_act_{index}'
                db.add(models.Activity(id=activity_id, title=activity_id, eixo='all', created_at=T))
                db.add(models.ActivitySubmission(id=f'trainee1_{activity_id}', user_id='trainee1',
                                                 activity_id=activity_id))
                for user_id, eixo in [('trainee1', 'trainee'), ('membro_vendas', 'vendas')]:
                    node_id = f'extra_{user_id}_{index}'
                    db.add(models.TrainingNode(id=node_id, name=node_id, type='material', eixo=eixo,
                                               is_released=True, order_index=10 + index))
                    db.add(models.UserNodeProgress(id=node_id, user_id=user_id, node_id=node_id, completed=True,
                                                   completed_at=T))
            db.commit()
        self.assertEqual(measure(), before)


if __name__ == '__main__':
    unittest.main()
