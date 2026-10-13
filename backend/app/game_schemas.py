"""Authoring payloads and publication validation for reusable game formats."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


GameFormat = Literal["quiz", "open_response", "scenario", "matching", "ordering", "categorization"]
Eixo = Literal["trainee", "vendas", "conexoes", "experiencia", "all"]


class QuizOption(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=5000)
    is_correct: bool = False
    feedback: str = Field(default="", max_length=10000)


class QuizQuestion(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=10000)
    selection: Literal["single", "multiple"] = "single"
    weight: int = Field(default=1, ge=1, le=100)
    explanation: str = Field(default="", max_length=10000)
    options: list[QuizOption] = Field(min_length=2, max_length=20)

    @model_validator(mode="after")
    def valid_answers(self):
        if len({option.id for option in self.options}) != len(self.options):
            raise ValueError("As alternativas precisam de identificadores únicos")
        count = sum(option.is_correct for option in self.options)
        if not count or (self.selection == "single" and count != 1):
            raise ValueError("Defina o gabarito: uma resposta para escolha única; uma ou mais para múltipla")
        return self


class QuizConfig(StrictModel):
    questions: list[QuizQuestion] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("As perguntas precisam de identificadores únicos")
        return self


class OpenQuestion(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=10000)
    weight: int = Field(default=1, ge=1, le=100)
    grading_notes: str = Field(default="", max_length=10000)


class OpenResponseConfig(StrictModel):
    questions: list[OpenQuestion] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("As perguntas precisam de identificadores únicos")
        return self


class ScenarioOption(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=5000)
    score: int = Field(default=0, ge=0, le=100)
    feedback: str = Field(default="", max_length=10000)
    next_step_id: str | None = None


class ScenarioStep(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=10000)
    options: list[ScenarioOption] = Field(min_length=2, max_length=20)

    @model_validator(mode="after")
    def unique_options(self):
        if len({option.id for option in self.options}) != len(self.options):
            raise ValueError("As decisões precisam de identificadores únicos")
        return self


class ScenarioConfig(StrictModel):
    start_step_id: str = Field(min_length=1, max_length=100)
    steps: list[ScenarioStep] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def finite_reachable_graph(self):
        steps = {step.id: step for step in self.steps}
        if len(steps) != len(self.steps):
            raise ValueError("Os passos precisam de identificadores únicos")
        if self.start_step_id not in steps:
            raise ValueError("Selecione um passo inicial existente")
        for step in self.steps:
            for option in step.options:
                if option.next_step_id is not None and option.next_step_id not in steps:
                    raise ValueError("Toda decisão deve apontar para um passo existente ou encerrar")
        visited, visiting = set(), set()

        def visit(step_id):
            if step_id in visiting:
                raise ValueError("O cenário não pode conter ciclos")
            if step_id in visited:
                return
            visiting.add(step_id)
            for option in steps[step_id].options:
                if option.next_step_id is not None:
                    visit(option.next_step_id)
            visiting.remove(step_id)
            visited.add(step_id)

        visit(self.start_step_id)
        if len(visited) != len(steps):
            raise ValueError("Todos os passos devem ser alcançáveis a partir do início")
        if not any(option.score > 0 for step in self.steps for option in step.options):
            raise ValueError("Defina pontos para pelo menos uma decisão")
        return self


class MatchingCard(StrictModel):
    """The matching card carries its own id: sharing it with the item would reveal the pair."""

    id: str = Field(min_length=1, max_length=100)
    right_id: str = Field(min_length=1, max_length=100)
    left: str = Field(min_length=1, max_length=5000)
    right: str = Field(min_length=1, max_length=5000)
    feedback: str = Field(default="", max_length=10000)


class MatchingDistractor(StrictModel):
    """Unpaired card on the right side, so guessing by elimination is not enough."""

    id: str = Field(min_length=1, max_length=100)
    right: str = Field(min_length=1, max_length=5000)


class MatchingConfig(StrictModel):
    pairs: list[MatchingCard] = Field(min_length=2, max_length=50)
    distractors: list[MatchingDistractor] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_cards(self):
        ids = ([card.id for card in self.pairs] + [card.right_id for card in self.pairs]
               + [card.id for card in self.distractors])
        if len(set(ids)) != len(ids):
            raise ValueError("Os cartões precisam de identificadores únicos dos dois lados")
        rights = [card.right for card in self.pairs] + [card.right for card in self.distractors]
        if len({text.casefold() for text in rights}) != len(rights):
            raise ValueError("Cada correspondência precisa de um texto distinto para ter resposta única")
        return self


class OrderingItem(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=5000)


class OrderingConfig(StrictModel):
    """The authored sequence is the answer key; the player receives it shuffled."""

    items: list[OrderingItem] = Field(min_length=2, max_length=50)
    explanation: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def unique_items(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Os itens precisam de identificadores únicos")
        return self


class Category(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)


class CategorizedItem(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=5000)
    category_id: str = Field(min_length=1, max_length=100)
    feedback: str = Field(default="", max_length=10000)


class CategorizationConfig(StrictModel):
    categories: list[Category] = Field(min_length=2, max_length=20)
    items: list[CategorizedItem] = Field(min_length=2, max_length=100)

    @model_validator(mode="after")
    def consistent_categories(self):
        if len({category.id for category in self.categories}) != len(self.categories):
            raise ValueError("As categorias precisam de identificadores únicos")
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Os itens precisam de identificadores únicos")
        known = {category.id for category in self.categories}
        if any(item.category_id not in known for item in self.items):
            raise ValueError("Todo item deve pertencer a uma categoria existente")
        used = {item.category_id for item in self.items}
        if used != known:
            raise ValueError("Cada categoria precisa de pelo menos um item")
        return self


PUBLICATION_SCHEMAS: dict[str, type[StrictModel]] = {
    "quiz": QuizConfig, "open_response": OpenResponseConfig, "scenario": ScenarioConfig, "matching": MatchingConfig,
    "ordering": OrderingConfig, "categorization": CategorizationConfig,
}


class GameCreate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(default="", max_length=10000)
    eixo: Eixo
    format: GameFormat
    # Incomplete configuration is intentionally allowed until publication.
    config: dict[str, Any] = Field(default_factory=dict)


class GameUpdate(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    instructions: str | None = Field(default=None, max_length=10000)
    eixo: Eixo | None = None
    format: GameFormat | None = None
    config: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_nulls(self):
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Os campos do jogo não podem ser nulos")
        return self


class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    game_id: str
    version: int
    title: str
    instructions: str
    format: GameFormat
    config: dict[str, Any]
    max_points: int
    published_at: datetime


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    instructions: str
    eixo: str
    format: GameFormat
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    published_revision: RevisionOut | None = None
    has_unpublished_changes: bool = True


class QuizAnswer(StrictModel):
    question_id: str
    option_ids: list[str] = Field(min_length=1, max_length=20)


class MatchAnswer(StrictModel):
    left_id: str
    right_id: str


class PlacementAnswer(StrictModel):
    item_id: str
    category_id: str


class OpenAnswer(StrictModel):
    question_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=5000)


class QuestionGrade(StrictModel):
    question_id: str = Field(min_length=1, max_length=100)
    grade: float = Field(ge=0, le=10, allow_inf_nan=False)
    feedback: str = Field(default="", max_length=10000)


class OpenResponseGrade(StrictModel):
    questions: list[QuestionGrade] = Field(min_length=1, max_length=100)


class AttemptComplete(StrictModel):
    """One list per format; the evaluator rejects lists that belong to another one."""

    answers: list[QuizAnswer] = Field(default_factory=list, max_length=100)
    matches: list[MatchAnswer] = Field(default_factory=list, max_length=50)
    order: list[str] = Field(default_factory=list, max_length=50)
    placements: list[PlacementAnswer] = Field(default_factory=list, max_length=100)
    open_answers: list[OpenAnswer] = Field(default_factory=list, max_length=100)

    def submitted_fields(self) -> set[str]:
        return {field for field in ("answers", "matches", "order", "placements", "open_answers") if getattr(self, field)}


class ScenarioAnswer(StrictModel):
    step_id: str
    option_id: str
