"""A nota de rotação é calculada, não digitada: cobertura da fórmula e dos gatilhos."""
import unittest

import test_creation
from app import models
from app.api import auth, grades, users
from app.services import activity_service


class GradingTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        for prefix, module in [('/api/auth', auth), ('/api/users', users)]:
            self.api.app.include_router(module.router, prefix=prefix)
        self.api.app.include_router(grades.router, prefix='/api')
        with self.api.sessions() as db:
            db.add(models.User(id='trainee', name='Trainee', email='trainee@example.com',
                               password_hash='unused', cargo='Trainee', type='trainee'))
            db.commit()
        self.request, self.create = self.api.request, self.api.create

    def tearDown(self):
        self.api.tearDown()

    def grade_of(self, user_id):
        with self.api.sessions() as db:
            return db.query(models.User).filter(models.User.id == user_id).one().nota_rotacao

    def activity(self, weight=1.0, eixo='trainee', **extra):
        return self.create('activities', {'title': 'Atividade', 'eixo': eixo, 'accepts_file': False,
                                          'weight': weight, **extra})

    def deliver(self, activity, role='trainee', comment='Entrega'):
        node = self.create('nodes', {'type': 'activity', 'eixo': activity['eixo'],
                                     'activity_id': activity['id'], 'is_released': True})
        status, submission = self.request('POST', f"/api/activities/{activity['id']}/submit",
                                          {'node_id': node['id'], 'comment': comment}, role=role)
        self.assertEqual(status, 200, submission)
        return submission

    def grade(self, activity, submission, value, expected=200):
        status, body = self.request(
            'PATCH', f"/api/activities/{activity['id']}/submissions/{submission['id']}",
            {'grade': value, 'feedback': 'Comentário'})
        self.assertEqual(status, expected, body)
        return body

    def test_weighted_average_formula(self):
        cases = [
            ([(10, 2), (5, 1)], 8.33),
            ([], None),
            ([(9, None)], 9.0),
            ([(8, 0), (6, 0)], None),
            ([(10, 0), (4, 1)], 4.0),
            ([(1, 3), (2, 3)], 1.5),
        ]
        for pairs, expected in cases:
            with self.subTest(pairs=pairs):
                normalized = [(grade, activity_service.normalize_weight(weight)) for grade, weight in pairs]
                self.assertEqual(activity_service.weighted_average(normalized), expected)

    def test_grade_computes_weighted_average_for_trainee_and_membro(self):
        for role, eixo in [('trainee', 'trainee'), ('membro', 'vendas')]:
            with self.subTest(role=role):
                heavy, light = self.activity(weight=2, eixo=eixo), self.activity(weight=1, eixo=eixo)
                self.grade(heavy, self.deliver(heavy, role=role), 10)
                self.assertEqual(self.grade_of(role), 10.0)
                self.grade(light, self.deliver(light, role=role), 5)
                self.assertEqual(self.grade_of(role), 8.33)
                status, rows = self.request('GET', '/api/grades')
                self.assertEqual(status, 200, rows)
                self.assertEqual(next(row['nota_rotacao'] for row in rows if row['id'] == role), 8.33)

    def test_uncorrected_deliveries_do_not_lower_the_average(self):
        graded, pending = self.activity(), self.activity()
        self.grade(graded, self.deliver(graded), 10)
        self.deliver(pending)
        self.assertEqual(self.grade_of('trainee'), 10.0)

    def test_resubmission_clears_current_grade_but_preserves_best_in_average(self):
        first, second = self.activity(), self.activity()
        self.grade(first, self.deliver(first), 10)
        self.grade(second, self.deliver(second), 4)
        self.assertEqual(self.grade_of('trainee'), 7.0)
        self.deliver(second, comment='Entrega revisada')
        self.assertEqual(self.grade_of('trainee'), 7.0)

    def test_weight_change_recomputes_everyone_graded_on_the_activity(self):
        heavy, light = self.activity(weight=1), self.activity(weight=1)
        self.grade(heavy, self.deliver(heavy), 10)
        self.grade(light, self.deliver(light), 0)
        self.assertEqual(self.grade_of('trainee'), 5.0)
        status, _ = self.request('PATCH', f"/api/activities/{heavy['id']}", {'weight': 3})
        self.assertEqual(status, 200)
        self.assertEqual(self.grade_of('trainee'), 7.5)
        status, _ = self.request('PATCH', f"/api/activities/{heavy['id']}", {'title': 'Só o título'})
        self.assertEqual(status, 200)
        self.assertEqual(self.grade_of('trainee'), 7.5)

    def test_deleting_an_activity_removes_its_grade_from_the_average(self):
        kept, removed = self.activity(), self.activity()
        self.grade(kept, self.deliver(kept), 8)
        self.grade(removed, self.deliver(removed), 2)
        self.assertEqual(self.grade_of('trainee'), 5.0)
        status, _ = self.request('DELETE', f"/api/activities/{removed['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(self.grade_of('trainee'), 8.0)
        status, _ = self.request('DELETE', f"/api/activities/{kept['id']}")
        self.assertEqual(status, 200)
        self.assertIsNone(self.grade_of('trainee'))

    def test_grade_outside_zero_to_ten_is_rejected_without_touching_the_average(self):
        activity = self.activity()
        submission = self.deliver(activity)
        self.grade(activity, submission, 7)
        for invalid in [-1, 10.5, 'abc']:
            with self.subTest(grade=invalid):
                self.grade(activity, submission, invalid, expected=422)
        self.assertEqual(self.grade_of('trainee'), 7.0)

    def test_rotation_grade_cannot_be_typed_and_rotation_needs_an_organizer(self):
        status, body = self.request('PUT', '/api/users/trainees/trainee', {'notaRotacao': 9})
        self.assertEqual(status, 422, body)
        status, _ = self.request('PUT', '/api/users/trainees/trainee', {'rotacao': 2}, role='membro')
        self.assertEqual(status, 403)
        status, body = self.request('PUT', '/api/users/trainees/trainee', {'rotacao': 2}, role='organizador')
        self.assertEqual(status, 200, body)
        self.assertEqual(body['rotacao'], 2)
        self.assertIsNone(body['nota_rotacao'])
        status, _ = self.request('PUT', '/api/users/trainees/trainee', {'rotacao': 3})
        self.assertEqual(status, 400)

    def test_new_people_start_without_a_grade(self):
        status, created = self.request('POST', '/api/users', {
            'name': 'Novo', 'email': 'novo@example.com', 'cargo': 'Trainee',
            'type': 'trainee', 'password': 'test-only'})
        self.assertEqual(status, 200, created)
        self.assertIsNone(created['nota_rotacao'])

    def test_backfill_corrects_values_typed_before_the_change(self):
        activity = self.activity(weight=2)
        self.grade(activity, self.deliver(activity), 6)
        with self.api.sessions() as db:
            db.query(models.User).filter(models.User.id == 'trainee').one().nota_rotacao = 9.9
            db.query(models.User).filter(models.User.id == 'membro').one().nota_rotacao = 4.4
            db.commit()
        with self.api.sessions() as db:
            activity_service.recompute_all_grades(db)
            db.commit()
        self.assertEqual(self.grade_of('trainee'), 6.0)
        self.assertIsNone(self.grade_of('membro'))

    def queue(self, query='', role='admin', expected=200):
        status, body = self.request('GET', '/api/submissions' + query, role=role)
        self.assertEqual(status, expected, body)
        return body

    def test_queue_lists_pending_first_and_filters(self):
        graded_activity, pending_activity = self.activity(weight=3), self.activity()
        graded_submission = self.deliver(graded_activity)
        self.grade(graded_activity, graded_submission, 7)
        membro_activity = self.activity(eixo='vendas')
        self.deliver(membro_activity, role='membro')
        pending_submission = self.deliver(pending_activity)

        rows = self.queue()
        self.assertEqual(len(rows), 3)
        self.assertIsNone(rows[0]['grade'])
        self.assertIsNone(rows[1]['grade'])
        self.assertEqual(rows[2]['id'], graded_submission['id'])

        corrected = next(row for row in rows if row['id'] == graded_submission['id'])
        self.assertEqual(corrected['activity_title'], 'Atividade')
        self.assertEqual(corrected['activity_weight'], 3.0)
        self.assertEqual(corrected['activity_eixo'], 'trainee')
        self.assertEqual(corrected['user_name'], 'Trainee')
        self.assertEqual(corrected['user_type'], 'trainee')

        self.assertEqual([row['id'] for row in self.queue('?status=graded')], [graded_submission['id']])
        self.assertEqual(len(self.queue('?status=pending')), 2)
        self.assertEqual([row['id'] for row in self.queue(f"?activity_id={pending_activity['id']}")],
                         [pending_submission['id']])
        self.assertEqual([row['user_type'] for row in self.queue('?user_type=membro')], ['membro'])
        self.assertEqual([row['user_id'] for row in self.queue('?user_id=trainee')], ['trainee', 'trainee'])
        self.assertEqual([row['activity_eixo'] for row in self.queue('?eixo=vendas')], ['vendas'])
        self.assertEqual(len(self.queue('?limit=1')), 1)
        self.assertEqual(len(self.queue('?limit=1&offset=2')), 1)
        self.queue('?eixo=inexistente', expected=422)

    def test_queue_permissions_and_axis_scoping(self):
        trainee_activity = self.activity()
        self.deliver(trainee_activity)
        sales_activity = self.activity(eixo='vendas')
        self.deliver(sales_activity, role='membro')
        shared_activity = self.activity(eixo='all')
        self.deliver(shared_activity, role='membro')

        for role in ['membro', 'trainee']:
            with self.subTest(role=role):
                self.queue(role=role, expected=403)
        self.queue(role=None, expected=401)

        organizer_rows = self.queue(role='organizador')
        self.assertEqual([row['activity_eixo'] for row in organizer_rows], ['trainee'])
        self.assertEqual({row['user_type'] for row in organizer_rows}, {'trainee'})
        self.assertEqual(len(self.queue()), 3)

    def test_zero_weight_is_preserved_and_excluded_from_average(self):
        practice, graded = self.activity(weight=0, is_required=False), self.activity(weight=2)
        self.assertEqual(practice['weight'], 0)
        self.grade(practice, self.deliver(practice), 10)
        self.assertIsNone(self.grade_of('trainee'))
        self.grade(graded, self.deliver(graded), 6)
        self.assertEqual(self.grade_of('trainee'), 6)
        status, _ = self.request('PATCH', f"/api/activities/{graded['id']}", {'weight': 0, 'is_required': False})
        self.assertEqual(status, 200)
        self.assertIsNone(self.grade_of('trainee'))
        for weight in [-1, 'NaN', 'Infinity']:
            status, _ = self.request('PATCH', f"/api/activities/{graded['id']}", {'weight': weight})
            self.assertEqual(status, 422)

    def test_managers_do_not_submit_activities_or_receive_progress(self):
        activity = self.activity()
        material = self.create('materials', {'name': 'Texto', 'type': 'trainee', 'eixo': 'trainee'})
        node = self.create('nodes', {'type': 'material', 'eixo': 'trainee', 'reference_id': material['id'], 'is_released': True})
        for role in ['admin', 'organizador']:
            status, _ = self.request('POST', f"/api/activities/{activity['id']}/submit", {'comment': 'Teste'}, role=role)
            self.assertEqual(status, 403)
            status, _ = self.request('POST', f"/api/nodes/{node['id']}/complete", role=role)
            self.assertEqual(status, 403)
        with self.api.sessions() as db:
            self.assertEqual(db.query(models.ActivitySubmission).count(), 0)
            self.assertEqual(db.query(models.UserNodeProgress).count(), 0)

    def test_deleting_a_submission_removes_its_grade_and_reopens_the_trail_step(self):
        activity = self.activity()
        submission = self.deliver(activity)
        self.grade(activity, submission, 8)
        self.assertEqual(self.grade_of('trainee'), 8.0)
        with self.api.sessions() as db:
            node = db.query(models.TrainingNode).filter_by(activity_id=activity['id']).one()
            self.assertTrue(db.query(models.UserNodeProgress).filter_by(
                user_id='trainee', node_id=node.id, completed=True).first())

        status, body = self.request('DELETE', f"/api/activities/{activity['id']}/submissions/{submission['id']}")
        self.assertEqual(status, 200, body)
        self.assertIsNone(self.grade_of('trainee'))
        with self.api.sessions() as db:
            self.assertIsNone(db.get(models.ActivitySubmission, submission['id']))
            self.assertIsNone(db.query(models.UserNodeProgress).filter_by(
                user_id='trainee', node_id=node.id).first())

        _, activities_after = self.request('GET', '/api/activities', role='trainee')
        self.assertIsNone(next(a for a in activities_after if a['id'] == activity['id'])['my_submission'])

    def test_organizer_can_delete_a_trainee_submission_but_not_a_membro_submission(self):
        trainee_activity = self.activity()
        trainee_submission = self.deliver(trainee_activity)
        membro_activity = self.activity(eixo='vendas')
        membro_submission = self.deliver(membro_activity, role='membro')

        status, body = self.request(
            'DELETE', f"/api/activities/{membro_activity['id']}/submissions/{membro_submission['id']}",
            role='organizador')
        self.assertEqual(status, 403, body)

        status, body = self.request(
            'DELETE', f"/api/activities/{trainee_activity['id']}/submissions/{trainee_submission['id']}",
            role='organizador')
        self.assertEqual(status, 200, body)
        with self.api.sessions() as db:
            self.assertIsNone(db.get(models.ActivitySubmission, trainee_submission['id']))

    def test_organizer_cannot_correct_former_trainees_now_members(self):
        activity = self.activity()
        submission = self.deliver(activity)
        with self.api.sessions() as db:
            db.query(models.User).filter(models.User.id == 'trainee').one().type = 'membro'
            db.commit()
        status, rows = self.request('GET', f"/api/activities/{activity['id']}/submissions", role='organizador')
        self.assertEqual(status, 200)
        self.assertEqual(rows, [])
        status, _ = self.request('PATCH', f"/api/activities/{activity['id']}/submissions/{submission['id']}", {'grade': 8}, role='organizador')
        self.assertEqual(status, 403)
        self.grade(activity, submission, 8)

    def test_locked_trail_hides_linked_material_and_activity_until_prerequisite(self):
        first = self.create('materials', {'name': 'Primeiro', 'type': 'trainee', 'eixo': 'trainee'})
        node = self.create('nodes', {'type': 'material', 'reference_id': first['id'], 'eixo': 'trainee', 'is_released': True})
        second = self.create('materials', {'name': 'Segundo', 'type': 'trainee', 'eixo': 'trainee'})
        free = self.create('materials', {'name': 'Livre', 'type': 'trainee', 'eixo': 'trainee'})
        activity = self.activity(material_id=second['id'])
        self.create('nodes', {'type': 'activity', 'activity_id': activity['id'], 'eixo': 'trainee', 'is_released': True})
        # Material sem etapa não entra na biblioteca do participante.
        _, materials = self.request('GET', '/api/materials', role='trainee')
        self.assertEqual({row['id'] for row in materials}, {first['id']})
        _, activities = self.request('GET', '/api/activities', role='trainee')
        self.assertEqual(activities, [])
        status, _ = self.request('POST', f"/api/nodes/{node['id']}/complete", role='trainee')
        self.assertEqual(status, 200)
        _, materials = self.request('GET', '/api/materials', role='trainee')
        self.assertEqual({row['id'] for row in materials}, {first['id'], second['id']})
        _, materials = self.request('GET', '/api/materials', role='organizador')
        self.assertIn(free['id'], {row['id'] for row in materials})
        _, activities = self.request('GET', '/api/activities', role='trainee')
        self.assertEqual([row['id'] for row in activities], [activity['id']])
