"""BeautyMe — authentification de l'équipe d'administration et journal des actions.

Identifiants réglables par variables d'environnement :
    BEAUTYME_ADMIN_LOGIN     (défaut ADMIN)
    BEAUTYME_ADMIN_PASSWORD  (défaut MUSIC7, uniquement en mode démonstration)
Hors démonstration (BEAUTYME_DEMO=0), l'accès admin reste fermé tant que le mot de passe
n'est pas fourni par l'environnement.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

DEMO = os.getenv("BEAUTYME_DEMO", "1") == "1"
LOGIN = os.getenv("BEAUTYME_ADMIN_LOGIN", "ADMIN")
_PW = os.getenv("BEAUTYME_ADMIN_PASSWORD") or ("MUSIC7" if DEMO else None)
_SALT = secrets.token_bytes(16)
_PW_HASH = hashlib.scrypt(_PW.encode(), salt=_SALT, n=2**14, r=8, p=1, dklen=32) if _PW else None
del _PW

SESSION_TTL = timedelta(hours=12)
MAX_FAILS = 5
LOCK_WINDOW = timedelta(minutes=15)

router = APIRouter(prefix="/v1/admin")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class AdminState:
    lock: threading.RLock = field(default_factory=threading.RLock)
    sessions: dict[str, datetime] = field(default_factory=dict)
    fails: list[datetime] = field(default_factory=list)
    log: list[dict] = field(default_factory=list)

    def record(self, action: str, detail: str, now: datetime | None = None) -> None:
        with self.lock:
            self.log.append({"at": (now or utcnow()).isoformat(), "by": LOGIN, "action": action, "detail": detail})
            del self.log[:-500]


_state = AdminState()


def admin_state() -> AdminState:
    return _state


def admin_now() -> datetime:
    return utcnow()


AS = Annotated[AdminState, Depends(admin_state)]
ANow = Annotated[datetime, Depends(admin_now)]


def _mac(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def require_admin(st: AS, now: ANow, authorization: Annotated[str | None, Header()] = None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Connectez-vous à l'espace d'administration.")
    exp = st.sessions.get(_mac(authorization[7:]))
    if not exp or exp < now:
        raise HTTPException(401, "Session d'administration expirée. Reconnectez-vous.")


class AdminLoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


@router.post("/connexion")
def admin_login(body: AdminLoginIn, st: AS, now: ANow) -> dict:
    if _PW_HASH is None:
        raise HTTPException(503, "Accès admin non configuré : définissez BEAUTYME_ADMIN_PASSWORD.")
    with st.lock:
        st.fails = [t for t in st.fails if now - t < LOCK_WINDOW]
        if len(st.fails) >= MAX_FAILS:
            raise HTTPException(429, "Trop d'essais. Réessayez dans 15 minutes.")
        given = hashlib.scrypt(body.password.encode(), salt=_SALT, n=2**14, r=8, p=1, dklen=32)
        ok = hmac.compare_digest(given, _PW_HASH) & hmac.compare_digest(body.login.strip().upper(), LOGIN.upper())
        if not ok:
            st.fails.append(now)
            raise HTTPException(401, "Identifiant ou mot de passe incorrect.")
        st.fails.clear()
        tok = secrets.token_urlsafe(32)
        st.sessions[_mac(tok)] = now + SESSION_TTL
    st.record("connexion", "Connexion à l'administration", now)
    return {"token": tok, "login": LOGIN, "expires_in": int(SESSION_TTL.total_seconds())}


@router.post("/deconnexion", status_code=204)
def admin_logout(st: AS, authorization: Annotated[str | None, Header()] = None) -> None:
    if authorization and authorization.startswith("Bearer "):
        st.sessions.pop(_mac(authorization[7:]), None)


@router.get("/journal", dependencies=[Depends(require_admin)])
def journal(st: AS) -> list[dict]:
    return list(reversed(st.log))
