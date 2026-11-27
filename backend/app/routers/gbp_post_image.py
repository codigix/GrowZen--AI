"""The picture of a Google post, served to Google: GET /public/gbp-post-image/<token>.jpg. Only the picture of one post, by a signed address; nothing else is exposed."""
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Business, Post
from ..services import post_image_host as host

public_router = APIRouter(prefix="/public/gbp-post-image", tags=["public-gbp-post-image"])


@public_router.get("/upload/{business_id}/{digest}.jpg")
def uploaded(business_id: int, digest: str):
    """A picture a person uploaded for a post (kept here, not in the profile's Photos). The name is a hash of the picture, so only someone given the address can fetch it."""
    from ..services import featured_images as fi
    if not re.fullmatch(r"[0-9a-f]{24}", digest):
        raise HTTPException(404, "Not found")
    path = (fi.UPLOAD_ROOT / "post-pictures" / str(int(business_id)) / f"{digest}.jpg")
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return Response(content=path.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@public_router.get("/{token}.jpg")
def picture(token: str, db: Session = Depends(get_db)):
    pid = host.post_of(token)
    p = db.get(Post, pid) if pid else None
    b = db.get(Business, p.business_id) if p else None
    if p is None or b is None:
        raise HTTPException(404, "Not found")
    return Response(content=host.picture_bytes(b, p), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})
