"""
api/materials.py — Material/content endpoints (/api/materials/*)
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user, get_current_staff
from app.services.node_service import library_material_ids
from app.services import access, audit
from app.services.material_files import validate_document_links
from app.services.access import (
    allowed_material_types,
    ensure_material_access,
)

router = APIRouter()


def _record_material(db: Session, user: models.User, action: str, material: models.Material, details=None) -> None:
    audit.record(db, user, action, entity_type="material", entity_id=material.id, entity_name=material.name,
                 eixo=material.eixo, details=details)


@router.get("", response_model=List[schemas.MaterialOut])
@router.get("/", response_model=List[schemas.MaterialOut], include_in_schema=False)
def get_materials(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Material)
    allowed = allowed_material_types(current_user)
    if allowed is not None:
        query = query.filter(models.Material.type.in_(allowed))
    if current_user.type == "gerente":
        query = query.filter(models.Material.eixo.in_(access.manageable_eixos(current_user)))
    # Participantes só veem o que a trilha já alcançou; a autoria segue o escopo do cargo.
    reachable = library_material_ids(db, current_user)
    if reachable is not None:
        query = query.filter(models.Material.id.in_(reachable))
    return query.all()


@router.post("", response_model=schemas.MaterialOut)
@router.post("/", response_model=schemas.MaterialOut, include_in_schema=False)
def create_material(
    material_in: schemas.MaterialCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    ensure_material_access(current_user, material_in, manage=True)
    validate_document_links(db, current_user, material_in.documents)

    new_material = models.Material(
        id=str(uuid.uuid4()),
        name=material_in.name,
        type=material_in.type,
        eixo=material_in.eixo,
        text=material_in.text or "",
    )
    db.add(new_material)
    db.flush()

    for doc in material_in.documents:
        db.add(models.Document(
            id=str(uuid.uuid4()),
            material_id=new_material.id,
            name=doc.name,
            url=doc.url,
        ))

    for video_url in material_in.videos:
        db.add(models.Video(
            id=str(uuid.uuid4()),
            material_id=new_material.id,
            url=video_url,
        ))

    _record_material(db, current_user, "material.create", new_material)
    db.commit()
    db.refresh(new_material)
    return new_material


@router.put("/{material_id}", response_model=schemas.MaterialOut)
def update_material(
    material_id: str,
    material_in: schemas.MaterialCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    material = db.query(models.Material).filter(models.Material.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    ensure_material_access(current_user, material, manage=True)
    # O material atual e o destino passam pela mesma regra: não dá para puxar um
    # material de outro eixo nem movê-lo para fora do próprio.
    ensure_material_access(current_user, material_in, manage=True)
    access.ensure_contained_in_axis(db, current_user, material)
    validate_document_links(db, current_user, material_in.documents, material)
    before = {"nome": material.name, "tipo": material.type, "eixo": material.eixo}
    text_before = material.text or ""
    # Consultas de colunas, sem carregar as coleções que a troca abaixo apaga.
    documents_before = sorted(tuple(row) for row in db.query(models.Document.name, models.Document.url).filter(
        models.Document.material_id == material_id).all())
    videos_before = sorted(url for (url,) in db.query(models.Video.url).filter(
        models.Video.material_id == material_id).all())

    material.name = material_in.name
    material.type = material_in.type
    material.eixo = material_in.eixo
    material.text = material_in.text or ""

    db.query(models.Document).filter(models.Document.material_id == material_id).delete()
    db.query(models.Video).filter(models.Video.material_id == material_id).delete()

    for doc in material_in.documents:
        db.add(models.Document(
            id=str(uuid.uuid4()),
            material_id=material_id,
            name=doc.name,
            url=doc.url,
        ))

    for video_url in material_in.videos:
        db.add(models.Video(
            id=str(uuid.uuid4()),
            material_id=material_id,
            url=video_url,
        ))

    # Texto, documentos e vídeos entram só como "alterado" e contagens, não o conteúdo.
    details = audit.changes(before, {"nome": material.name, "tipo": material.type, "eixo": material.eixo})
    if material.text != text_before:
        details["texto"] = "alterado"
    documents_after = sorted((doc.name, doc.url) for doc in material_in.documents)
    if documents_after != documents_before:
        details["documentos"] = {"antes": len(documents_before), "depois": len(documents_after)}
    if sorted(material_in.videos) != videos_before:
        details["vídeos"] = {"antes": len(videos_before), "depois": len(material_in.videos)}
    if details:
        _record_material(db, current_user, "material.update", material, details)
    db.commit()
    db.refresh(material)
    return material


@router.delete("/{material_id}")
def delete_material(
    material_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    material = db.query(models.Material).filter(models.Material.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material não encontrado")

    ensure_material_access(current_user, material, manage=True)
    access.ensure_contained_in_axis(db, current_user, material)

    _record_material(db, current_user, "material.delete", material)
    db.delete(material)
    db.commit()
    return {"detail": "Material deletado com sucesso"}
