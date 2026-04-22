"""SQLModel table definitions — imported eagerly so SQLModel.metadata sees them."""

from .address_book import AddressBook
from .api_token import ApiToken
from .audit_log import AuditLog
from .device import Device
from .join_token import JoinToken
from .tag import DeviceTag, Tag
from .user import User

__all__ = [
    "AddressBook",
    "ApiToken",
    "AuditLog",
    "Device",
    "DeviceTag",
    "JoinToken",
    "Tag",
    "User",
]
