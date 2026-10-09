from typing import Annotated, Optional, List, Literal
from datetime import datetime, timezone
from pydantic import AfterValidator, BaseModel, EmailStr, ConfigDict, Field, field_validator, model_validator

Role = Literal["admin", "organizador", "gerente", "membro", "trainee"]


def _instant_in(value: datetime) -> datetime:
    # Without an offset the client could mean UTC or its own local time.
    if value.utcoffset() is None:
        raise ValueError("Informe o fuso horário (Z ou um deslocamento como -03:00).")
    return value.astimezone(timezone.utc)


def _instant_out(value: datetime) -> datetime:
    # The columns store UTC without tzinfo, including legacy rows.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Release times and deadlines: requests must state the timezone; responses always do.
UtcInstantIn = Annotated[datetime, AfterValidator(_instant_in)]
UtcInstantOut = Annotated[datetime, AfterValidator(_instant_out)]

# --- User Schemas ---
class UserBase(BaseModel):
    name: str
    email: EmailStr
    cargo: str
    type: Role
    eixo: Optional[str] = None
    photo: Optional[str] = ""

MIN_PASSWORD_LENGTH = 6


class UserCreate(UserBase):
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

class UserOut(UserBase):
    id: str
    nota_rotacao: Optional[float] = None
    pontos_acumulados: int = 0
    rotacao: Optional[int] = None
    password_prompt_pending: bool = False

    model_config = ConfigDict(from_attributes=True)

class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Informe o nome.")
        return value.strip()


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class SuggestionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def text_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Escreva a sugestão.")
        return value.strip()


class SuggestionOut(BaseModel):
    id: str
    author_id: Optional[str] = None
    author_name: str
    text: str
    created_at: UtcInstantOut
    read_at: Optional[UtcInstantOut] = None

    model_config = ConfigDict(from_attributes=True)


class SuggestionUpdate(BaseModel):
    read: bool


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = None
    type: Optional[Role] = None
    eixo: Optional[str] = None
    password: Optional[str] = None  # vazio mantém a senha atual

    @field_validator("password")
    @classmethod
    def password_long_enough(cls, value):
        if value is not None and value.strip() and len(value) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
        return value

class TraineeUpdate(BaseModel):
    # A nota de rotação não entra aqui: ela é calculada a partir das atividades
    # corrigidas. Recusar o campo em vez de ignorá-lo evita um cliente antigo
    # achar que gravou uma nota.
    model_config = ConfigDict(extra="forbid")

    rotacao: Optional[int] = None  # 1 ou 2

# --- Document Schemas ---
class DocumentBase(BaseModel):
    name: str
    url: str

class DocumentCreate(DocumentBase):
    pass

class DocumentOut(DocumentBase):
    id: str

    model_config = ConfigDict(from_attributes=True)

# --- Video Schemas ---
class VideoBase(BaseModel):
    url: str

class VideoCreate(VideoBase):
    pass

class VideoOut(VideoBase):
    id: str

    model_config = ConfigDict(from_attributes=True)

# --- Material Schemas ---
class MaterialBase(BaseModel):
    name: str
    type: str  # "membro", "trainee"
    eixo: str  # "vendas", "conexoes", "experiencia"
    text: Optional[str] = ""

class MaterialCreate(MaterialBase):
    type: Literal["membro", "trainee"]
    eixo: Literal["vendas", "conexoes", "experiencia", "trainee", "all"]
    documents: List[DocumentCreate] = []
    videos: List[str] = []  # List of URLs

class MaterialOut(MaterialBase):
    id: str
    documents: List[DocumentOut] = []
    videos: List[VideoOut] = []

    model_config = ConfigDict(from_attributes=True)

# --- Auth Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut

class TokenData(BaseModel):
    email: Optional[str] = None

# --- Game & Node Graph Schemas ---

class OptionOut(BaseModel):
    id: str
    text: str
    is_correct: Optional[bool] = None
    score: Optional[int] = None
    feedback: Optional[str] = ""

    model_config = ConfigDict(from_attributes=True)

class QuestionOut(BaseModel):
    id: str
    text: str
    explanation: Optional[str] = ""
    options: List[OptionOut] = []

    model_config = ConfigDict(from_attributes=True)

class AssessmentSettings(BaseModel):
    allow_retry: bool = True
    is_required: bool = True
    weight: float = Field(default=1.0, ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def required_weight(self):
        if self.is_required and self.weight <= 0:
            raise ValueError("Atividades e jogos obrigatórios precisam de peso maior que zero")
        return self


class TrainingNodeOut(BaseModel):
    id: str
    name: str
    type: str  # "activity", "material", "game"
    reference_id: Optional[str] = None
    game_revision_id: Optional[str] = None
    game_format: Optional[Literal["quiz", "scenario", "matching", "ordering", "categorization"]] = None
    allow_retry: bool = True
    is_required: bool = True
    weight: float = 1.0
    activity_id: Optional[str] = None
    eixo: str
    prerequisite_node_id: Optional[str] = None
    x_pos: Optional[float] = 0.0
    y_pos: Optional[float] = 0.0
    order_index: int = 0
    questions: List[QuestionOut] = []
    is_released: bool = False
    released_at: Optional[UtcInstantOut] = None
    deadline: Optional[UtcInstantOut] = None
    released_by: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class TrainingNodeGraphOut(TrainingNodeOut):
    # Pré-requisito que vale de fato: o escolhido à mão ou a etapa anterior do eixo.
    effective_prerequisite_id: Optional[str] = None
    completed: bool = False
    unlocked: bool = True
    user_score: int = 0
    grade: Optional[float] = None

class NodeActivityUpdate(BaseModel):
    activity_id: str = Field(min_length=1)


class TrainingNodeUpdate(BaseModel):
    allow_retry: Optional[bool] = None
    is_required: Optional[bool] = None
    weight: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1)
    activity_id: Optional[str] = None
    reference_id: Optional[str] = None
    game_revision_id: Optional[str] = None
    prerequisite_node_id: Optional[str] = None
    deadline: Optional[UtcInstantIn] = None

    @model_validator(mode="after")
    def assessment_not_null(self):
        if any(field in self.model_fields_set and getattr(self, field) is None
               for field in ("allow_retry", "is_required", "weight")):
            raise ValueError("Repetição, obrigatoriedade e peso não podem ser nulos")
        return self


class NodeReleaseUpdate(BaseModel):
    is_released: bool
    released_at: Optional[UtcInstantIn] = None  # None = liberar imediatamente

class OptionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=1)
    is_correct: bool = False
    score: int = Field(default=0, ge=0)
    feedback: Optional[str] = ""

class QuestionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=1)
    explanation: Optional[str] = ""
    options: List[OptionCreate] = Field(min_length=2)

    @model_validator(mode="after")
    def validate_answers(self):
        if not any(option.is_correct for option in self.options):
            raise ValueError("Cada pergunta precisa de pelo menos uma alternativa correta")
        return self

class TrainingNodeCreate(AssessmentSettings):
    name: Optional[str] = None
    type: Literal["activity", "material", "game"]
    eixo: Literal["trainee", "vendas", "conexoes", "experiencia", "all"]
    activity_id: Optional[str] = None
    reference_id: Optional[str] = None
    game_revision_id: Optional[str] = None
    prerequisite_node_id: Optional[str] = None
    is_released: bool = False
    deadline: Optional[UtcInstantIn] = None
    questions: List[QuestionCreate] = []

    @model_validator(mode="after")
    def validate_content(self):
        if self.type == "game":
            if not self.questions and not self.game_revision_id:
                raise ValueError("Selecione um jogo publicado ou adicione perguntas")
            if self.questions and self.game_revision_id:
                raise ValueError("Selecione um jogo publicado ou perguntas, sem misturar os formatos")
            if self.activity_id:
                raise ValueError("Jogos não podem vincular uma atividade de entrega")
        elif self.type == "material" and not self.reference_id:
            raise ValueError("Selecione o material da etapa")
        elif self.type == "activity" and not (self.activity_id or self.reference_id):
            raise ValueError("Selecione a atividade da etapa")
        if self.type != "game" and self.questions:
            raise ValueError("Perguntas são permitidas apenas em jogos")
        if self.type != "game" and self.game_revision_id:
            raise ValueError("Versões de jogos são permitidas apenas em etapas de jogo")
        return self

class GameAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str
    option_id: str

class GameSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: List[GameAnswer] = Field(min_length=1)

# --- Activity & Submission Schemas ---

class ActivityCreate(AssessmentSettings):
    title: str
    description: Optional[str] = ""
    eixo: str  # "trainee", "vendas", "conexoes", "experiencia", "all"
    accepts_file: bool = True
    deadline: Optional[UtcInstantIn] = None
    material_id: Optional[str] = None
    weight: float = Field(default=1.0, ge=0, allow_inf_nan=False)

class ActivityUpdate(BaseModel):
    allow_retry: Optional[bool] = None
    is_required: Optional[bool] = None
    is_open: Optional[bool] = None
    deadline: Optional[UtcInstantIn] = None
    title: Optional[str] = None
    description: Optional[str] = None
    accepts_file: Optional[bool] = None
    material_id: Optional[str] = None
    weight: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    @model_validator(mode="after")
    def assessment_not_null(self):
        if any(field in self.model_fields_set and getattr(self, field) is None
               for field in ("allow_retry", "is_required", "weight")):
            raise ValueError("Repetição, obrigatoriedade e peso não podem ser nulos")
        return self


class SubmissionAttachmentOut(BaseModel):
    id: str
    name: str
    size: int
    url: str
    model_config = ConfigDict(from_attributes=True)


class AttachmentUploadRequest(BaseModel):
    name: str
    size: int
    node_id: Optional[str] = None


class AttachmentUploadToken(BaseModel):
    pathname: str
    token: str


class AttachmentRegister(BaseModel):
    pathname: str
    name: str
    node_id: Optional[str] = None


class ActivitySubmissionOut(BaseModel):
    id: str
    activity_id: str
    user_id: str
    file_url: Optional[str] = None
    links: List[str] = Field(default_factory=list, max_length=10)
    attachments: List[SubmissionAttachmentOut] = Field(default_factory=list)
    comment: Optional[str] = ""
    submitted_at: Optional[datetime] = None
    grade: Optional[float] = None
    previous_grade: Optional[float] = None
    effective_grade: Optional[float] = None
    feedback: Optional[str] = ""
    user_name: Optional[str] = None      # populated from join
    user_type: Optional[str] = None      # trainee ou membro, para a fila de correção
    activity_title: Optional[str] = None
    activity_weight: Optional[float] = None
    activity_eixo: Optional[str] = None
    graded_by_name: Optional[str] = None  # quem lançou a nota atual
    graded_at: Optional[UtcInstantOut] = None

    model_config = ConfigDict(from_attributes=True)

class ActivityOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    eixo: str
    accepts_file: bool
    # Prazo efetivo: numa atividade da trilha, vem das etapas (o mais tardio).
    deadline: Optional[UtcInstantOut] = None
    deadline_from_trail: bool = False
    is_open: bool
    weight: float = 1.0
    allow_retry: bool = True
    is_required: bool = True
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    material_id: Optional[str] = None
    # computed: effective_open (deadline check)
    effective_open: bool = True
    submission_count: int = 0
    my_submission: Optional[ActivitySubmissionOut] = None  # present for trainee/member requests

    model_config = ConfigDict(from_attributes=True)

class NodeContentOut(BaseModel):
    node: TrainingNodeGraphOut
    activity: Optional[ActivityOut] = None
    material: Optional[MaterialOut] = None


class SubmissionCreate(BaseModel):
    node_id: Optional[str] = None
    file_url: Optional[str] = None  # Older clients may still send a link here.
    attachment_ids: List[str] = Field(default_factory=list, max_length=5)
    links: List[str] = Field(default_factory=list, max_length=10)
    comment: Optional[str] = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def validate_links(self):
        from urllib.parse import urlsplit
        self.links = [link.strip() for link in self.links if link.strip()]
        if self.file_url:
            self.file_url = self.file_url.strip() or None
        for link in self.links + ([self.file_url] if self.file_url else []):
            parsed = urlsplit(link)
            if len(link) > 2048 or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Informe links válidos começando com http:// ou https://")
        if len(self.attachment_ids) != len(set(self.attachment_ids)):
            raise ValueError("Um anexo não pode ser enviado duas vezes")
        return self

class SubmissionGrade(BaseModel):
    grade: float = Field(ge=0, le=10)
    feedback: Optional[str] = ""


class SubmissionBatchGrade(SubmissionGrade):
    """A mesma nota (e o mesmo feedback, se houver) para várias entregas de uma vez."""
    submission_ids: List[str] = Field(min_length=1, max_length=200)


# --- Profile & Grades Schemas ---

class NodeProgressOut(BaseModel):
    node_id: str
    node_name: str
    node_type: str
    completed: bool
    score: int
    grade: Optional[float] = None
    weight: float = 1.0
    is_required: bool = True
    completed_at: Optional[datetime] = None

class UserProfileOut(BaseModel):
    id: str
    name: str
    email: str
    cargo: str
    type: str
    eixo: Optional[str] = None
    rotacao: Optional[int] = None
    nota_rotacao: Optional[float] = None
    pontos_acumulados: int = 0
    node_progress: List[NodeProgressOut] = []
    activity_submissions: List[ActivitySubmissionOut] = []

class NodeOrderUpdate(BaseModel):
    order_index: int

class GradeRow(BaseModel):
    id: str
    name: str
    email: str
    cargo: str
    type: str
    eixo: Optional[str] = None
    rotacao: Optional[int] = None
    nota_rotacao: Optional[float] = None
    pontos_acumulados: int = 0
    nodes_completed: int = 0
    nodes_total: int = 0
    activities_submitted: int = 0
    activities_graded: int = 0
