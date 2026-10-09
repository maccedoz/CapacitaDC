import uuid
from datetime import timezone
from sqlalchemy import Column, String, Float, Boolean, ForeignKey, Text, Integer, DateTime, JSON, LargeBinary, UniqueConstraint, true
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator
from app.database import Base

def generate_uuid():
    return str(uuid.uuid4())


class UTCDateTime(TypeDecorator):
    """UTC instant stored without tzinfo, the format the existing columns already use.

    Aware values are converted before reaching the driver, so the stored value does
    not depend on the database session time zone. Naive values are already UTC.
    """
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    cargo = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "admin", "organizador", "gerente", "membro", "trainee"
    eixo = Column(String, nullable=True)   # "vendas", "conexoes", "experiencia"; registros antigos usam o nome de exibição
    photo = Column(String, nullable=True, default="")
    nota_rotacao = Column(Float, nullable=True)
    pontos_acumulados = Column(Integer, default=0, nullable=False)
    rotacao = Column(Integer, nullable=True)  # 1 ou 2 — apenas para trainees
    # Bloqueio de login após senhas erradas seguidas (o contador fica no banco
    # porque a API roda em funções serverless, sem memória compartilhada).
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(UTCDateTime, nullable=True)
    # Troca da própria senha: sobe a versão da sessão, e tokens com a versão antiga deixam de valer.
    password_changed_at = Column(UTCDateTime, nullable=True)
    token_version = Column(Integer, default=0, nullable=False)
    # Popup que sugere trocar a senha definida pela gestão; some ao trocar ou dispensar.
    password_prompt_pending = Column(Boolean, default=True, nullable=False)

    # Relationships
    node_progress = relationship("UserNodeProgress", back_populates="user", cascade="all, delete-orphan")

class Material(Base):
    __tablename__ = "materials"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "membro", "trainee"
    eixo = Column(String, nullable=False)  # "vendas", "conexoes", "experiencia"
    text = Column(Text, nullable=True, default="")

    # Relationships
    documents = relationship("Document", back_populates="material", cascade="all, delete-orphan")
    videos = relationship("Video", back_populates="material", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=generate_uuid)
    material_id = Column(String, ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)

    # Relationships
    material = relationship("Material", back_populates="documents")

class Video(Base):
    __tablename__ = "videos"

    id = Column(String, primary_key=True, default=generate_uuid)
    material_id = Column(String, ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, nullable=False)

    # Relationships
    material = relationship("Material", back_populates="videos")

# --- Trilha de Aprendizado em Grafo / Jogos ---

class TrainingNode(Base):
    __tablename__ = "training_nodes"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "material", "game"
    reference_id = Column(String, nullable=True)  # Material.id if type == "material", null if game
    game_revision_id = Column(String, ForeignKey("game_revisions.id", ondelete="RESTRICT"), nullable=True)
    game_revision = relationship("GameRevision")
    allow_retry = Column(Boolean, default=True, server_default=true(), nullable=False)
    is_required = Column(Boolean, default=True, server_default=true(), nullable=False)
    weight = Column(Float, default=1.0, server_default="1", nullable=False)
    eixo = Column(String, nullable=False)  # "vendas", "conexoes", "experiencia", "trainee"
    prerequisite_node_id = Column(String, ForeignKey("training_nodes.id", ondelete="SET NULL"), nullable=True)
    x_pos = Column(Float, nullable=True, default=0.0)
    y_pos = Column(Float, nullable=True, default=0.0)
    order_index = Column(Integer, default=0, nullable=False)  # controla a ordem na trilha

    # Controle de liberação (somente admin/organizador pode alterar)
    is_released = Column(Boolean, default=False, nullable=False)
    released_at = Column(UTCDateTime, nullable=True)   # UTC sem tzinfo; a API recebe/devolve fuso explícito
    released_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    activity_id = Column(String, ForeignKey("activities.id", ondelete="SET NULL"), nullable=True)
    activity = relationship("Activity")
    deadline = Column(UTCDateTime, nullable=True)  # Prazo da atividade associada ao nó (UTC sem tzinfo)

    # Relationships
    questions = relationship("Question", back_populates="node", cascade="all, delete-orphan")
    progress = relationship("UserNodeProgress", back_populates="node", cascade="all, delete-orphan")
    game_attempts = relationship("GameAttempt", back_populates="node", cascade="all, delete-orphan")

class Question(Base):
    __tablename__ = "questions"

    id = Column(String, primary_key=True, default=generate_uuid)
    node_id = Column(String, ForeignKey("training_nodes.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    explanation = Column(Text, nullable=True, default="")

    # Relationships
    node = relationship("TrainingNode", back_populates="questions")
    options = relationship("Option", back_populates="question", cascade="all, delete-orphan")

class Option(Base):
    __tablename__ = "options"

    id = Column(String, primary_key=True, default=generate_uuid)
    question_id = Column(String, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    text = Column(String, nullable=False)
    is_correct = Column(Boolean, default=False, nullable=False)
    score = Column(Integer, default=0, nullable=False)
    feedback = Column(Text, nullable=True, default="")

    # Relationships
    question = relationship("Question", back_populates="options")

class UserNodeProgress(Base):
    __tablename__ = "user_node_progress"
    __table_args__ = (UniqueConstraint("user_id", "node_id", name="uq_user_node_progress"),)

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(String, ForeignKey("training_nodes.id", ondelete="CASCADE"), nullable=False)
    completed = Column(Boolean, default=False, nullable=False)
    score = Column(Integer, default=0, nullable=False)
    grade = Column(Float, nullable=True)  # Melhor nota do jogo, de 0 a 10
    completed_at = Column(UTCDateTime, nullable=True)

    # Relationships
    user = relationship("User", back_populates="node_progress")
    node = relationship("TrainingNode", back_populates="progress")


class Game(Base):
    __tablename__ = "games"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    instructions = Column(Text, nullable=False, default="")
    eixo = Column(String, nullable=False)
    format = Column(String, nullable=False)
    config = Column(JSON, nullable=False, default=dict)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)
    revisions = relationship("GameRevision", back_populates="game", cascade="all, delete-orphan", order_by="GameRevision.version")


class GameRevision(Base):
    __tablename__ = "game_revisions"
    __table_args__ = (UniqueConstraint("game_id", "version", name="uq_game_revision_version"),)

    id = Column(String, primary_key=True, default=generate_uuid)
    game_id = Column(String, ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    version = Column(Integer, nullable=False)
    title = Column(String, nullable=False)
    instructions = Column(Text, nullable=False, default="")
    format = Column(String, nullable=False)
    config = Column(JSON, nullable=False)
    max_points = Column(Integer, nullable=False, default=100)
    published_at = Column(UTCDateTime, nullable=False)
    game = relationship("Game", back_populates="revisions")


class GameAttempt(Base):
    __tablename__ = "game_attempts"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id = Column(String, ForeignKey("training_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    game_revision_id = Column(String, ForeignKey("game_revisions.id", ondelete="RESTRICT"), nullable=False)
    # One resumable attempt per user/node. Completed attempts release this key.
    active_key = Column(String, unique=True, nullable=True)
    status = Column(String, nullable=False, default="in_progress")
    answers = Column(JSON, nullable=False, default=list)
    result = Column(JSON, nullable=True)
    started_at = Column(UTCDateTime, nullable=False)
    completed_at = Column(UTCDateTime, nullable=True)
    node = relationship("TrainingNode", back_populates="game_attempts")
    revision = relationship("GameRevision")


# --- Atividades com envio de arquivo e deadline ---

class Activity(Base):
    __tablename__ = "activities"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True, default="")
    eixo = Column(String, nullable=False)          # "trainee", "vendas", "conexoes", "experiencia", "all"
    accepts_file = Column(Boolean, default=True, nullable=False)  # Se exige envio de arquivo
    deadline = Column(UTCDateTime, nullable=True)  # UTC sem tzinfo; None = sem prazo definido
    is_open = Column(Boolean, default=True, nullable=False)  # Fechamento manual ou automático via deadline
    allow_retry = Column(Boolean, default=True, server_default=true(), nullable=False)
    is_required = Column(Boolean, default=True, server_default=true(), nullable=False)
    weight = Column(Float, default=1.0, nullable=False)    # Peso para cálculo de média ponderada
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime, nullable=True)

    material_id = Column(String, ForeignKey("materials.id", ondelete="SET NULL"), nullable=True)
    material = relationship("Material")

    # Relationships
    submissions = relationship("ActivitySubmission", back_populates="activity", cascade="all, delete-orphan")


class ActivitySubmission(Base):
    __tablename__ = "activity_submissions"

    id = Column(String, primary_key=True, default=generate_uuid)
    activity_id = Column(String, ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    file_url = Column(String, nullable=True)       # Legacy submissions
    links = Column(JSON, nullable=True, default=list)
    attachments = relationship("SubmissionAttachment", back_populates="submission")
    comment = Column(Text, nullable=True, default="")  # Comentário opcional do trainee
    submitted_at = Column(UTCDateTime, nullable=True)
    grade = Column(Float, nullable=True)           # Nota da entrega atual (0-10)
    previous_grade = Column(Float, nullable=True)  # Melhor nota das entregas anteriores
    feedback = Column(Text, nullable=True, default="")  # Feedback do avaliador

    # Relationships
    activity = relationship("Activity", back_populates="submissions")
    user = relationship("User")


class SubmissionAttachment(Base):
    __tablename__ = "submission_attachments"
    id = Column(String, primary_key=True, default=generate_uuid)
    activity_id = Column(String, ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    submission_id = Column(String, ForeignKey("activity_submissions.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    storage_key = Column(String, nullable=False)
    size = Column(Integer, nullable=False)
    submission = relationship("ActivitySubmission", back_populates="attachments")

    @property
    def url(self):
        return f"/api/activities/{self.activity_id}/attachments/{self.id}"


class MaterialUpload(Base):
    """Who sent a material file, so it stays private until linked to a material."""
    __tablename__ = "material_uploads"
    id = Column(String, primary_key=True, default=generate_uuid)
    storage_key = Column(String, unique=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    eixo = Column(String, nullable=True)  # eixo do gerente que enviou; nulo para os demais perfis


class UserPhoto(Base):
    """Foto de perfil já recortada e reduzida no navegador (algumas dezenas de KB)."""
    __tablename__ = "user_photos"
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    content_type = Column(String, nullable=False)
    data = Column(LargeBinary, nullable=False)
    updated_at = Column(UTCDateTime, nullable=False)


class Suggestion(Base):
    """Sugestão ou ideia enviada por um trainee; administradores e organizadores leem."""
    __tablename__ = "suggestions"
    id = Column(String, primary_key=True, default=generate_uuid)
    author_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    author_name = Column(String, nullable=False)  # guardado no envio, para continuar legível se a conta sair
    text = Column(Text, nullable=False)
    created_at = Column(UTCDateTime, nullable=False)
    read_at = Column(UTCDateTime, nullable=True)
    read_by_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
