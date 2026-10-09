"""Small, versioned migrations for the existing SQLite/PostgreSQL databases.

Run on startup. Legacy quiz rows and accumulated points are preserved; a null
game_revision_id explicitly selects the compatible legacy quiz evaluator.
"""

from sqlalchemy import inspect, text

from app.database import Base


def migrate(engine):
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            # Serialize startup migrations across workers/processes.
            connection.execute(text("SELECT pg_advisory_xact_lock(729143820)"))
        Base.metadata.create_all(bind=connection)
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ))
        applied = set(connection.execute(text("SELECT version FROM schema_migrations")).scalars())
        if 1 not in applied:
            columns = {column["name"] for column in inspect(connection).get_columns("training_nodes")}
            if "game_revision_id" not in columns:
                connection.execute(text(
                    "ALTER TABLE training_nodes ADD COLUMN game_revision_id VARCHAR "
                    "REFERENCES game_revisions(id) ON DELETE RESTRICT"
                ))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (1)"))
        if 2 not in applied:
            # Preserve the best result/completion from old duplicate progress rows.
            # The total points already awarded are deliberately left unchanged.
            duplicates = connection.execute(text(
                "SELECT user_id, node_id FROM user_node_progress "
                "GROUP BY user_id, node_id HAVING COUNT(*) > 1"
            )).mappings().all()
            for pair in duplicates:
                rows = connection.execute(text(
                    "SELECT id, completed, score, completed_at FROM user_node_progress "
                    "WHERE user_id = :user_id AND node_id = :node_id ORDER BY id"
                ), dict(pair)).mappings().all()
                keeper = rows[0]["id"]
                completed_at = next((row["completed_at"] for row in rows if row["completed_at"]), None)
                connection.execute(text(
                    "UPDATE user_node_progress SET completed = :completed, score = :score, "
                    "completed_at = :completed_at WHERE id = :id"
                ), {"completed": any(row["completed"] for row in rows),
                    "score": max(row["score"] for row in rows),
                    "completed_at": completed_at, "id": keeper})
                connection.execute(text(
                    "DELETE FROM user_node_progress WHERE user_id = :user_id "
                    "AND node_id = :node_id AND id <> :id"
                ), {**dict(pair), "id": keeper})
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_node_progress "
                "ON user_node_progress (user_id, node_id)"
            ))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (2)"))
        if 3 not in applied:
            # "pluginfo" era um eixo de conteúdo que nenhum participante alcançava.
            # O papel PlugInfo (users.type = "organizador") não é afetado por isto.
            # Cada passo confere as colunas antes de rodar: create_all só cria tabelas
            # que faltam, então um banco antigo pode não ter todas elas.
            def columns_of(table):
                return {column["name"] for column in inspect(connection).get_columns(table)}

            node_columns = columns_of("training_nodes")
            if "eixo" in node_columns:
                if "order_index" in node_columns:
                    # As etapas convertidas entram depois das que já existem no eixo
                    # trainee, para a trilha manter uma ordem única. A renumeração vem
                    # antes da troca de eixo, senão a subconsulta já enxerga as movidas.
                    connection.execute(text(
                        "UPDATE training_nodes SET order_index = order_index + "
                        "(SELECT COALESCE(MAX(order_index), -1) + 1 FROM training_nodes WHERE eixo = 'trainee') "
                        "WHERE eixo = 'pluginfo'"
                    ))
                # Voltam bloqueadas: conteúdo que nunca esteve visível não deve surgir liberado.
                assignments, params = ["eixo = 'trainee'"], {}
                if "is_released" in node_columns:
                    assignments.append("is_released = :closed")
                    params["closed"] = False
                if "released_at" in node_columns:
                    assignments.append("released_at = NULL")
                connection.execute(text(
                    f"UPDATE training_nodes SET {', '.join(assignments)} WHERE eixo = 'pluginfo'"
                ), params)
            for table, column in [("materials", "type"), ("materials", "eixo"),
                                  ("activities", "eixo"), ("games", "eixo")]:
                if column in columns_of(table):
                    connection.execute(text(
                        f"UPDATE {table} SET {column} = 'trainee' WHERE {column} = 'pluginfo'"
                    ))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (3)"))
        if 4 not in applied:
            # A nota de rotação deixa de ser digitada e passa a ser a média ponderada
            # das entregas já corrigidas. O valor digitado até aqui é sobrescrito, por
            # isso fica guardado antes: se alguma nota refletia critério de fora da
            # plataforma, ela só existe nesta cópia.
            from collections import defaultdict
            from app.services.activity_service import normalize_weight, weighted_average

            connection.execute(text(
                "CREATE TABLE IF NOT EXISTS nota_rotacao_backup_v4 AS "
                "SELECT id, nota_rotacao FROM users"
            ))
            # A coluna de peso nunca foi criada por migração: em um banco anterior a
            # ela, toda correção quebraria ao consultar activities.weight.
            if "weight" not in {column["name"] for column in inspect(connection).get_columns("activities")}:
                connection.execute(text(
                    "ALTER TABLE activities ADD COLUMN weight FLOAT NOT NULL DEFAULT 1.0"
                ))
            connection.execute(text("UPDATE activities SET weight = 1.0 WHERE weight IS NULL"))
            connection.execute(text("UPDATE users SET nota_rotacao = NULL"))
            # O recálculo é em Python de propósito: ROUND com casas decimais não existe
            # igual nos dois bancos, e assim a migração usa a mesma fórmula do servidor.
            pairs = defaultdict(list)
            for user_id, grade, weight in connection.execute(text(
                "SELECT s.user_id, s.grade, a.weight FROM activity_submissions s "
                "JOIN activities a ON a.id = s.activity_id WHERE s.grade IS NOT NULL"
            )).all():
                pairs[user_id].append((float(grade), normalize_weight(weight)))
            for user_id, graded in pairs.items():
                average = weighted_average(graded)
                if average is not None:
                    connection.execute(
                        text("UPDATE users SET nota_rotacao = :average WHERE id = :id"),
                        {"average": average, "id": user_id},
                    )
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (4)"))

        if 5 not in applied:
            columns = {column["name"] for column in inspect(connection).get_columns("activity_submissions")}
            if "links" not in columns:
                connection.execute(text("ALTER TABLE activity_submissions ADD COLUMN links JSON"))
            connection.execute(text("UPDATE activity_submissions SET links = '[]' WHERE links IS NULL"))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (5)"))

        if 6 not in applied:
            from collections import defaultdict
            from app.services.activity_service import weighted_average
            from app.services.assessment_service import normalized_grade

            connection.execute(text("CREATE TABLE IF NOT EXISTS nota_rotacao_backup_v6 AS SELECT id, nota_rotacao FROM users"))
            additions = {
                "activities": {"allow_retry": "BOOLEAN NOT NULL DEFAULT TRUE", "is_required": "BOOLEAN NOT NULL DEFAULT TRUE"},
                "training_nodes": {"allow_retry": "BOOLEAN NOT NULL DEFAULT TRUE", "is_required": "BOOLEAN NOT NULL DEFAULT TRUE", "weight": "FLOAT NOT NULL DEFAULT 1.0"},
                "user_node_progress": {"grade": "FLOAT"},
                "activity_submissions": {"previous_grade": "FLOAT"},
            }
            for table, fields in additions.items():
                columns = {column["name"] for column in inspect(connection).get_columns(table)}
                for name, definition in fields.items():
                    if name not in columns:
                        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
            # Peso zero já representava prática sem participação na média.
            connection.execute(text("UPDATE activities SET is_required = FALSE WHERE weight <= 0"))
            legacy_maximum = defaultdict(float)
            for node_id, maximum in connection.execute(text(
                "SELECT q.node_id, MAX(o.score) FROM questions q JOIN options o ON o.question_id = q.id GROUP BY q.id, q.node_id"
            )):
                legacy_maximum[node_id] += max(0, maximum or 0)
            for progress in connection.execute(text(
                "SELECT p.id, p.node_id, p.score, n.game_revision_id, r.max_points FROM user_node_progress p "
                "JOIN training_nodes n ON n.id = p.node_id LEFT JOIN game_revisions r ON r.id = n.game_revision_id "
                "WHERE n.type = 'game' AND p.completed = TRUE AND p.grade IS NULL"
            )).mappings().all():
                maximum = progress["max_points"] or 0 if progress["game_revision_id"] else legacy_maximum[progress["node_id"]]
                if maximum > 0:
                    connection.execute(text("UPDATE user_node_progress SET grade = :grade WHERE id = :id"),
                                       {"id": progress["id"], "grade": normalized_grade(progress["score"], maximum)})
            pairs = defaultdict(list)
            for user_id, grade, previous_grade, weight in connection.execute(text(
                "SELECT s.user_id, s.grade, s.previous_grade, a.weight FROM activity_submissions s "
                "JOIN activities a ON a.id = s.activity_id WHERE a.is_required = TRUE"
            )):
                best = max((value for value in (grade, previous_grade) if value is not None), default=None)
                if best is not None:
                    pairs[user_id].append((best, weight))
            for user_id, grade, weight in connection.execute(text(
                "SELECT p.user_id, p.grade, n.weight FROM user_node_progress p JOIN training_nodes n ON n.id = p.node_id "
                "WHERE n.type = 'game' AND n.is_required = TRUE AND p.completed = TRUE AND p.grade IS NOT NULL"
            )):
                pairs[user_id].append((grade, weight))
            connection.execute(text("UPDATE users SET nota_rotacao = NULL"))
            for user_id, graded in pairs.items():
                connection.execute(text("UPDATE users SET nota_rotacao = :grade WHERE id = :id"),
                                   {"id": user_id, "grade": weighted_average(graded)})
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (6)"))

        if 7 not in applied:
            columns = {column["name"] for column in inspect(connection).get_columns("users")}
            for name, definition in {"failed_login_attempts": "INTEGER NOT NULL DEFAULT 0",
                                     "locked_until": "TIMESTAMP"}.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (7)"))

        if 8 not in applied:
            # Fotos e sugestões são tabelas novas (create_all acima). Quem já usa o
            # sistema vê uma vez o popup de troca de senha: até aqui ninguém podia trocá-la.
            columns = {column["name"] for column in inspect(connection).get_columns("users")}
            for name, definition in {"password_changed_at": "TIMESTAMP",
                                     "token_version": "INTEGER NOT NULL DEFAULT 0",
                                     "password_prompt_pending": "BOOLEAN NOT NULL DEFAULT TRUE"}.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (8)"))

        if 9 not in applied:
            # O prazo passa a ser definido pela etapa da trilha. Etapas de atividade sem
            # prazo herdam o da atividade, para nenhuma entrega fechar antes ou depois do
            # que fechava; onde os dois existem, o da etapa passa a valer sem alteração.
            # A coluna da atividade continua valendo fora da trilha e fica copiada antes.
            node_columns = {column["name"] for column in inspect(connection).get_columns("training_nodes")}
            activity_columns = {column["name"] for column in inspect(connection).get_columns("activities")}
            if "deadline" in activity_columns:
                connection.execute(text(
                    "CREATE TABLE IF NOT EXISTS activity_deadline_backup_v9 AS SELECT id, deadline FROM activities"
                ))
                if {"type", "deadline", "activity_id", "reference_id"} <= node_columns:
                    # Etapas antigas guardavam a atividade em reference_id, como na leitura da etapa.
                    connection.execute(text(
                        "UPDATE training_nodes SET deadline = (SELECT a.deadline FROM activities a "
                        "WHERE a.id = COALESCE(training_nodes.activity_id, training_nodes.reference_id)) "
                        "WHERE type = 'activity' AND deadline IS NULL "
                        "AND COALESCE(activity_id, reference_id) IN (SELECT id FROM activities WHERE deadline IS NOT NULL)"
                    ))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (9)"))

        if 10 not in applied:
            # Histórico (audit_logs) é tabela nova; a entrega guarda quem lançou a nota atual.
            columns = {column["name"] for column in inspect(connection).get_columns("activity_submissions")}
            for name, definition in {"graded_by_id": "VARCHAR", "graded_at": "TIMESTAMP"}.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE activity_submissions ADD COLUMN {name} {definition}"))
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (10)"))

        if 11 not in applied:
            # create_all cria member_achievement_states. A primeira consulta de cada
            # membro guarda as conquistas existentes como vistas, sem emitir popups.
            connection.execute(text("INSERT INTO schema_migrations(version) VALUES (11)"))
