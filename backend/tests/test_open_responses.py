"""Open questions: immutable submissions, manual grades, deadlines and manager scope."""

from datetime import datetime, timedelta, timezone
import unittest

from sqlalchemy import inspect, text

import test_creation
from app import models
from app.api import dashboard, games
from app.migrations import migrate


class OpenResponseTests(unittest.TestCase):
    def setUp(self):
        self.api = test_creation.CreationTests()
        self.api.setUp()
        self.api.app.include_router(games.router, prefix="/api")
        self.api.app.include_router(dashboard.router, prefix="/api/dashboard")
        self.request, self.create = self.api.request, self.api.create
        with self.api.sessions() as db:
            db.get(models.User, "membro").eixo = "vendas"
            for name, role, eixo in [("trainee", "trainee", None), ("outro", "membro", "conexoes"),
                                     ("gerente", "gerente", "vendas"), ("gerente-outro", "gerente", "conexoes"),
                                     ("gerente-invalido", "gerente", None)]:
                db.add(models.User(id=name, name=name, email=f"{name}@example.com", password_hash="unused",
                                   cargo=role, type=role, eixo=eixo))
            db.commit()

    def tearDown(self):
        self.api.tearDown()

    def config(self):
        return {"questions": [
            {"id": "q1", "text": "Explique a abordagem", "weight": 2, "grading_notes": "Orientação interna secreta"},
            {"id": "q2", "text": "Descreva o próximo passo", "weight": 1},
        ]}

    def node(self, *, eixo="vendas", allow_retry=True):
        game = self.create("games", {"title": "Questionário aberto", "eixo": eixo,
                                     "format": "open_response", "config": self.config()})
        status, published = self.request("POST", f"/api/games/{game['id']}/publish", {})
        self.assertEqual(status, 200, published)
        return self.create("nodes", {"type": "game", "eixo": eixo, "is_released": True,
                                     "game_revision_id": published["published_revision"]["id"], "allow_retry": allow_retry})

    def begin(self, node, *, role="membro", new=False):
        status, body = self.request("POST", f"/api/nodes/{node['id']}/attempts" + ("?new_attempt=true" if new else ""), {}, role=role)
        self.assertEqual(status, 200, body)
        return body

    def answers(self):
        return {"open_answers": [{"question_id": "q1", "text": "Minha abordagem"},
                                 {"question_id": "q2", "text": "Meu próximo passo"}]}

    def submit(self, attempt, role="membro"):
        status, body = self.request("POST", f"/api/game-attempts/{attempt['id']}/complete", self.answers(), role=role)
        self.assertEqual(status, 200, body)
        return body

    def grade(self, attempt, first=9, second=3, *, role="admin"):
        return self.request("POST", f"/api/game-reviews/{attempt['id']}/grade", {"questions": [
            {"question_id": "q1", "grade": first, "feedback": "Bom raciocínio"},
            {"question_id": "q2", "grade": second, "feedback": "Detalhe melhor"},
        ]}, role=role)

    def test_publication_validates_questions_and_hides_internal_notes(self):
        for config in [{"questions": []}, {"questions": [{"id": "q1", "text": " "}]},
                       {"questions": [{"id": "q1", "text": "A", "weight": 0}]},
                       {"questions": [{"id": "q1", "text": "A"}, {"id": "q1", "text": "B"}]}]:
            game = self.create("games", {"title": "Rascunho", "format": "open_response", "eixo": "vendas", "config": config})
            status, body = self.request("POST", f"/api/games/{game['id']}/publish", {})
            self.assertEqual(status, 422, body)
        node = self.node()
        self.assertEqual(node["game_format"], "open_response")
        attempt = self.begin(node)
        self.assertEqual(attempt["questions"], [])
        self.assertEqual(attempt["open_questions"], [{"id": "q1", "text": "Explique a abordagem"},
                                                     {"id": "q2", "text": "Descreva o próximo passo"}])
        self.assertNotIn("secreta", repr(attempt))
        status, _ = self.request("GET", "/api/game-reviews", role="membro")
        self.assertEqual(status, 403)

    def test_submission_stays_pending_immutable_and_blocks_the_next_step(self):
        node = self.node()
        following = self.create("nodes", {"type": "game", "eixo": "vendas", "is_released": True,
                                          "game_revision_id": node["game_revision_id"]})
        attempt = self.submit(self.begin(node))
        self.assertEqual(attempt["status"], "pending_review")
        self.assertFalse(attempt["can_finish"])
        self.assertIsNone(attempt["result"])
        self.assertTrue(attempt["submitted_at"].endswith("Z"))
        self.assertEqual(self.begin(node, new=True)["id"], attempt["id"])
        status, repeat = self.request("POST", f"/api/game-attempts/{attempt['id']}/complete",
                                      {"open_answers": [{"question_id": "q1", "text": "Outra resposta"}]}, role="membro")
        self.assertEqual(status, 200, repeat)
        self.assertEqual(repeat["answers"], attempt["answers"])
        status, listing = self.request("GET", "/api/nodes", role="membro")
        self.assertFalse(next(item for item in listing if item["id"] == following["id"])["unlocked"])
        with self.api.sessions() as db:
            self.assertIsNone(db.get(models.User, "membro").nota_rotacao)
            self.assertEqual(db.get(models.User, "membro").pontos_acumulados, 0)
            self.assertEqual(db.query(models.UserNodeProgress).count(), 0)
        status, queue = self.request("GET", "/api/game-reviews")
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0]["questions"][0]["grading_notes"], "Orientação interna secreta")
        status, _ = self.request("GET", f"/api/game-attempts/{attempt['id']}", role="outro")
        self.assertEqual(status, 403)

    def test_manual_grade_updates_results_average_dashboard_and_audit_once(self):
        node = self.node()
        attempt = self.submit(self.begin(node))
        status, review = self.grade(attempt)
        self.assertEqual(status, 200, review)
        self.assertEqual(review["grade"], 7)
        self.assertEqual(review["graded_by_name"], "admin")
        status, result = self.request("GET", f"/api/game-attempts/{attempt['id']}", role="membro")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"]["attempt_score"], 70)
        self.assertTrue(result["result"]["step_completed"])
        self.assertEqual(result["result"]["feedback"][0]["answer"], "Minha abordagem")
        self.assertNotIn("secreta", repr(result))
        self.assertEqual(self.begin(node)["id"], attempt["id"])
        self.assertEqual(self.grade(attempt)[0], 200)
        with self.api.sessions() as db:
            self.assertEqual(db.get(models.User, "membro").nota_rotacao, 7)
            self.assertEqual(db.get(models.User, "membro").pontos_acumulados, 70)
            audits = db.query(models.AuditLog).filter_by(action="game.grade").all()
            self.assertEqual(len(audits), 1)
            self.assertEqual(audits[0].target_user_id, "membro")
            self.assertNotIn("Minha abordagem", repr(audits[0].details))
        status, stats = self.request("GET", f"/api/dashboard/games/{node['id']}")
        self.assertEqual(stats["revisions"][0]["format"], "open_response")
        self.assertIsNone(stats["revisions"][0]["items"][0]["correct_rate"])
        self.assertEqual(stats["revisions"][0]["items"][0]["score_rate"], .3)
        self.assertEqual(self.request("GET", "/api/game-reviews?status=pending")[1], [])
        self.assertEqual(len(self.request("GET", "/api/game-reviews?status=graded")[1]), 1)

    def test_retry_uses_best_grade_and_regrading_recomputes_without_duplicate_points(self):
        node = self.node()
        first = self.submit(self.begin(node))
        self.assertEqual(self.grade(first, 6, 6)[0], 200)
        self.assertFalse(self.request("GET", f"/api/game-attempts/{first['id']}", role="membro")[1]["result"]["step_completed"])
        second = self.submit(self.begin(node, new=True))
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.grade(second, 8, 8)[0], 200)
        self.assertEqual(self.grade(first, 3, 3)[0], 200)
        with self.api.sessions() as db:
            self.assertEqual(db.get(models.User, "membro").nota_rotacao, 8)
            self.assertEqual(db.get(models.User, "membro").pontos_acumulados, 80)
        self.assertEqual(self.grade(second, 5, 5)[0], 200)
        with self.api.sessions() as db:
            self.assertEqual(db.get(models.User, "membro").nota_rotacao, 5)
            self.assertEqual(db.get(models.User, "membro").pontos_acumulados, 50)
            self.assertFalse(db.query(models.UserNodeProgress).one().completed)

    def test_single_attempt_completes_at_any_grade_and_deadline_does_not_block_review(self):
        node = self.node(allow_retry=False)
        attempt = self.submit(self.begin(node))
        with self.api.sessions() as db:
            db.get(models.TrainingNode, node["id"]).deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self.begin(node)["status"], "pending_review")
        status, review = self.grade(attempt, 1, 1)
        self.assertEqual(status, 200, review)
        finished = self.begin(node, new=True)
        self.assertEqual(finished["id"], attempt["id"])
        self.assertTrue(finished["result"]["step_completed"])

    def test_deadline_closes_submission_and_retry_but_keeps_pending_results_readable(self):
        node = self.node()
        attempt = self.begin(node)
        with self.api.sessions() as db:
            db.get(models.TrainingNode, node["id"]).deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self.request("POST", f"/api/game-attempts/{attempt['id']}/complete", self.answers(), role="membro")[0], 400)
        with self.api.sessions() as db:
            db.get(models.TrainingNode, node["id"]).deadline = None
            db.commit()
        self.submit(attempt)
        with self.api.sessions() as db:
            db.get(models.TrainingNode, node["id"]).deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self.begin(node)["status"], "pending_review")
        self.assertEqual(self.grade(attempt)[0], 200)
        self.assertEqual(self.begin(node)["status"], "completed")
        self.assertEqual(self.request("POST", f"/api/nodes/{node['id']}/attempts?new_attempt=true", {}, role="membro")[0], 400)

    def test_rejects_incomplete_foreign_blank_and_oversized_answers_and_grades(self):
        attempt = self.begin(self.node())
        bad_answers = [[], [{"question_id": "q1", "text": "A"}],
                       [{"question_id": "q1", "text": "A"}, {"question_id": "q1", "text": "B"}],
                       [{"question_id": "q1", "text": "A"}, {"question_id": "unknown", "text": "B"}]]
        for answers in bad_answers:
            status, body = self.request("POST", f"/api/game-attempts/{attempt['id']}/complete", {"open_answers": answers}, role="membro")
            self.assertEqual(status, 400, body)
        for value in [" ", "a" * 5001]:
            status, body = self.request("POST", f"/api/game-attempts/{attempt['id']}/complete", {"open_answers": [{"question_id": "q1", "text": value}]}, role="membro")
            self.assertEqual(status, 422, body)
        payload = {**self.answers(), "order": ["q1"]}
        self.assertEqual(self.request("POST", f"/api/game-attempts/{attempt['id']}/complete", payload, role="membro")[0], 400)
        self.assertEqual(self.grade(attempt)[0], 409)
        self.submit(attempt)
        for value in [-1, 11]:
            self.assertEqual(self.grade(attempt, value)[0], 422)
        for ids in [["q1"], ["q1", "q1"], ["q1", "other"]]:
            status, body = self.request("POST", f"/api/game-reviews/{attempt['id']}/grade", {"questions": [{"question_id": qid, "grade": 10} for qid in ids]})
            self.assertEqual(status, 400, body)

    def test_manager_checks_both_content_axis_and_participant_and_organizer_only_trainees(self):
        own = self.node()
        attempt = self.submit(self.begin(own))
        foreign_person = self.submit(self.begin(own, role="outro"), role="outro")
        for role in ["gerente-outro", "gerente-invalido", "organizador", "membro"]:
            self.assertEqual(self.grade(attempt, role=role)[0], 403)
        self.assertEqual(self.grade(foreign_person, role="gerente")[0], 403)
        rows = self.request("GET", "/api/game-reviews", role="gerente")[1]
        self.assertEqual([row["id"] for row in rows], [attempt["id"]])
        self.assertEqual(self.grade(attempt, role="gerente")[0], 200)
        trainee_node = self.node(eixo="trainee")
        trainee_attempt = self.submit(self.begin(trainee_node, role="trainee"), role="trainee")
        self.assertEqual(self.grade(trainee_attempt, role="gerente-outro")[0], 200)
        self.assertEqual(len(self.request("GET", "/api/game-reviews?status=graded", role="organizador")[1]), 1)
        self.assertEqual(self.request("GET", "/api/game-reviews?eixo=vendas", role="organizador")[1], [])
        self.assertEqual(self.request("GET", "/api/game-reviews?eixo=invalid")[0], 422)
        self.assertEqual(self.request("GET", "/api/game-reviews", role="gerente-invalido")[0], 403)

    def test_migration_is_idempotent_and_preserves_old_attempts(self):
        node = self.node()
        attempt = self.submit(self.begin(node))
        self.grade(attempt)
        with self.api.engine.begin() as connection:
            snapshot = connection.execute(text("SELECT id, answers, result, status FROM game_attempts")).all()
            connection.execute(text(
                "CREATE TABLE game_attempts_v11 (id VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, "
                "node_id VARCHAR NOT NULL, game_revision_id VARCHAR NOT NULL, active_key VARCHAR UNIQUE, "
                "status VARCHAR NOT NULL, answers JSON NOT NULL, result JSON, started_at TIMESTAMP NOT NULL, "
                "completed_at TIMESTAMP)"
            ))
            connection.execute(text(
                "INSERT INTO game_attempts_v11 SELECT id, user_id, node_id, game_revision_id, active_key, "
                "status, answers, result, started_at, completed_at FROM game_attempts"
            ))
            connection.execute(text("DROP TABLE game_attempts"))
            connection.execute(text("ALTER TABLE game_attempts_v11 RENAME TO game_attempts"))
        migrate(self.api.engine)
        migrate(self.api.engine)
        with self.api.engine.connect() as connection:
            self.assertEqual(connection.execute(text("SELECT id, answers, result, status FROM game_attempts")).all(), snapshot)
            self.assertTrue({"submitted_at", "graded_at", "graded_by_id"} <= {column["name"] for column in inspect(connection).get_columns("game_attempts")})
            self.assertEqual(connection.execute(text("SELECT COUNT(*) FROM schema_migrations WHERE version = 12")).scalar(), 1)


if __name__ == "__main__":
    unittest.main()
