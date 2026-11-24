"""The picture of a Google post, served to Google: GET /public/gbp-post-image/<token>.jpg. Only the picture of one post, by a signed address; nothing else is exposed."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Business, Post
from ..services import post_image_host as host

public_router = APIRouter(prefix="/public/gbp-post-image", tags=["public-gbp-post-image"])


@public_router.get("/{token}.jpg")
def picture(token: str, db: Session = Depends(get_db)):
    pid = host.post_of(token)
    p = db.get(Post, pid) if pid else None
    b = db.get(Business, p.business_id) if p else None
    if p is None or b is None:
        raise HTTPException(404, "Not found")
    return Response(content=host.picture_bytes(b, p), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})
