from typing import ClassVar, Literal, Optional

from open_notebook.domain.base import ObjectModel


class User(ObjectModel):
    table_name: ClassVar[str] = "user"

    email: str
    display_name: str
    entra_oid: Optional[str] = None
    role: Literal["admin", "user"] = "user"
    client_id: str
