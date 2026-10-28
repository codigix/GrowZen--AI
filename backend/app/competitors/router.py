"""Find top competitors near a location (Google Maps). Read-only: nothing is saved."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import service

router = APIRouter(prefix="/competitors", tags=["competitors"])


class CompetitorsIn(BaseModel):
    business_type: str = Field(min_length=1, max_length=160)
    location: str = Field(min_length=1, max_length=200)
    own_firm_name: str = Field(default="", max_length=255)
    top_n: int = Field(default=10, ge=1, le=20)


@router.post("")
def find(body: CompetitorsIn):
    """Top competitors on Google Maps for a type of business near a location."""
    try:
        results = service.find_competitors(body.business_type.strip(), body.location.strip(), body.own_firm_name.strip(), body.top_n)
    except service.CompetitorSearchError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"business_type": body.business_type, "location": body.location, "count": len(results), "competitors": results}
