"""Authentication routes for login."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import create_access_token, verify_password
from app.db.database import get_db
from app.models.models import User
from app.schemas import TokenResponse, UserLogin


router = APIRouter(tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"user_id": user.id, "email": user.email})
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        email=user.email,
        role=user.role,
    )
