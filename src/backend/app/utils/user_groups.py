"""用户组权限模型 — 从 vSkin 搬运。

内置超级管理员、管理员、用户、老师、服务器管理员五种用户组，支持可视化展示与后台分组管理。
"""

SUPER_ADMIN_GROUP = "super_admin"
ADMIN_GROUP = "admin"
USER_GROUP = "user"
TEACHER_GROUP = "teacher"
SERVER_MANAGER_GROUP = "server_manager"

USER_GROUP_META = {
    SUPER_ADMIN_GROUP: {
        "title": "超级管理员",
        "color": "#F56C6C",
        "tag_type": "danger",
        "is_admin": True,
        "can_grant_admin": True,
    },
    ADMIN_GROUP: {
        "title": "管理员",
        "color": "#409EFF",
        "tag_type": "primary",
        "is_admin": True,
        "can_grant_admin": False,
    },
    TEACHER_GROUP: {
        "title": "老师",
        "color": "#9B59B6",
        "tag_type": "info",
        "is_admin": False,
        "can_grant_admin": False,
    },
    SERVER_MANAGER_GROUP: {
        "title": "服务器管理员",
        "color": "#E6A23C",
        "tag_type": "warning",
        "is_admin": False,
        "can_grant_admin": False,
    },
    USER_GROUP: {
        "title": "用户",
        "color": "#67C23A",
        "tag_type": "success",
        "is_admin": False,
        "can_grant_admin": False,
    },
}


def normalize_user_group(value) -> str:
    if not value:
        return USER_GROUP
    # Handle SQLAlchemy Enum type — extract .value if it's an enum
    if hasattr(value, "value"):
        value = value.value
    group = str(value).strip().lower()
    # Strip enum class prefix like "usergroup." that may appear from str()
    if "." in group:
        group = group.rsplit(".", 1)[-1]
    return group if group in USER_GROUP_META else USER_GROUP


def resolve_user_group(user_group, is_admin: int | bool = 0) -> str:
    normalized = normalize_user_group(user_group)
    if user_group:
        return normalized
    return ADMIN_GROUP if bool(is_admin) else USER_GROUP


def is_admin_group(user_group: str | None) -> bool:
    group = normalize_user_group(user_group)
    return bool(USER_GROUP_META[group]["is_admin"])


def can_grant_admin(user_group: str | None) -> bool:
    group = normalize_user_group(user_group)
    return bool(USER_GROUP_META[group]["can_grant_admin"])


def get_user_group_meta(user_group: str | None) -> dict:
    group = normalize_user_group(user_group)
    meta = USER_GROUP_META[group]
    return {
        "key": group,
        "title": meta["title"],
        "color": meta["color"],
        "tag_type": meta["tag_type"],
        "is_admin": bool(meta["is_admin"]),
        "can_grant_admin": bool(meta["can_grant_admin"]),
    }
