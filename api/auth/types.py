from dataclasses import dataclass
from typing import Literal, Optional


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str
    display_name: str
    role: Literal["admin", "user"]
    entra_oid: Optional[str]
    client_id: str
