from fastapi import APIRouter, Depends
from app.deps import get_current_user
from app.models import User

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return user.to_dict()
