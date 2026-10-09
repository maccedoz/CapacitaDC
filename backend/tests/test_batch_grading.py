"""Correção em lote, "corrigida por" e o registro das correções no histórico."""
import unittest

import test_grading
from app import models


class BatchGradingTests(unittest.TestCase):
    def setUp(self):
        self.base = test_grading.GradingTests()
        self.base.setUp()
        self.request, self.create = self.base.request, self.base.create
        self.activity, self.deliver, self.grade = self.base.activity, self.base.deliver, self.base.grade

    def tearDown(self):
        self.base.tearDown()

    def entries(self, action):
        with self.base.api.sessions() as db:
            return db.query(models.AuditLog).filter(models.AuditLog.action == action).order_by(models.AuditLog.created_at).all()

    def batch(self, ids, grade, role='admin', feedback='Bom trabalho'):
        return self.request('POST', '/api/submissions/grade-batch',
                            {'submission_ids': ids, 'grade': grade, 'feedback': feedback}, role=role)

    def test_grading_records_who_graded_and_the_change(self):
        activity = self.activity()
        submission = self.deliver(activity)
        body = self.grade(activity, submission, 6)
        self.assertEqual(body['graded_by_name'], 'admin')
        self.assertTrue(body['graded_at'].endswith('Z'))
        self.grade(activity, submission, 8)
        first, second = self.entries('submission.grade')
        self.assertEqual((second.actor_id, second.target_user_id, second.entity_name, second.eixo),
                         ('admin', 'trainee', 'Atividade', 'trainee'))
        self.assertEqual(first.details['nota'], {'antes': None, 'depois': 6.0})
        self.assertEqual(second.details, {'nota': {'antes': 6.0, 'depois': 8.0}})
        _, queue = self.request('GET', '/api/submissions?status=graded')
        self.assertEqual(queue[0]['graded_by_name'], 'admin')

    def test_deleting_a_submission_is_recorded(self):
        activity = self.activity()
        submission = self.deliver(activity)
        status, _ = self.request('DELETE', f"/api/activities/{activity['id']}/submissions/{submission['id']}")
        self.assertEqual(status, 200)
        (entry,) = self.entries('submission.delete')
        self.assertEqual((entry.entity_id, entry.target_user_name, entry.details['anexos']), (submission['id'], 'Trainee', 0))

    def test_batch_grades_every_submission_and_recomputes_each_average_once(self):
        heavy, light = self.activity(weight=2), self.activity(weight=1)
        first, second = self.deliver(heavy), self.deliver(light)
        member_activity = self.activity(eixo='vendas')
        member = self.deliver(member_activity, role='membro')
        status, body = self.batch([second['id'], first['id'], member['id'], first['id']], 9)
        self.assertEqual(status, 200, body)
        self.assertEqual([row['id'] for row in body], [second['id'], first['id'], member['id']])
        self.assertTrue(all(row['grade'] == 9 and row['feedback'] == 'Bom trabalho' and row['graded_by_name'] == 'admin' for row in body))
        self.assertEqual((self.base.grade_of('trainee'), self.base.grade_of('membro')), (9.0, 9.0))
        entries = self.entries('submission.grade_batch')
        self.assertEqual(len(entries), 3)
        self.assertTrue(all(entry.details['lote'] and entry.details['nota'] == {'antes': None, 'depois': 9.0} for entry in entries))

    def test_batch_is_all_or_nothing(self):
        trainee_activity, member_activity = self.activity(), self.activity(eixo='vendas')
        trainee_submission = self.deliver(trainee_activity)
        member_submission = self.deliver(member_activity, role='membro')
        # O organizador corrige trainees, não membros: o lote inteiro é recusado.
        status, _ = self.batch([trainee_submission['id'], member_submission['id']], 7, role='organizador')
        self.assertEqual(status, 403)
        status, _ = self.batch([trainee_submission['id'], 'nao-existe'], 7)
        self.assertEqual(status, 404)
        with self.base.api.sessions() as db:
            self.assertEqual(db.query(models.ActivitySubmission).filter(models.ActivitySubmission.grade.isnot(None)).count(), 0)
        self.assertEqual(self.entries('submission.grade_batch'), [])
        self.assertIsNone(self.base.grade_of('trainee'))

    def test_batch_validates_the_grade_and_requires_staff(self):
        submission = self.deliver(self.activity())
        for grade in [-1, 10.5]:
            self.assertEqual(self.batch([submission['id']], grade)[0], 422)
        self.assertEqual(self.batch([], 8)[0], 422)
        self.assertEqual(self.batch([submission['id']], 8, role='trainee')[0], 403)
        status, body = self.batch([submission['id']], 0, feedback=None)
        self.assertEqual((status, body[0]['grade'], body[0]['feedback']), (200, 0.0, ''))
