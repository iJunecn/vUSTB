"""积分系统 API。

用户接口：积分查询、每日签到、积分流水、爱发电充值验证
公开接口：爱发电 webhook 回调
"""
from __future__ import annotations

import hashlib
import json
import math
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User, PointAccount, PointTransaction, PointType, PointReason

router = APIRouter(prefix="/api/points", tags=["points"])

# ──────────────── helpers ────────────────

BJ_TZ = timezone(timedelta(hours=8))


async def _get_or_create_account(
    db: AsyncSession, user_id: int
) -> PointAccount:
    """获取用户积分账户，不存在则创建（像素积分默认 0，注册时另设）。"""
    acct = (
        await db.execute(
            select(PointAccount).where(PointAccount.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not acct:
        acct = PointAccount(user_id=user_id, pixel_points=0, shell_points=0)
        db.add(acct)
        await db.flush()
    return acct


async def _add_transaction(
    db: AsyncSession,
    user_id: int,
    ptype: PointType,
    amount: int,
    reason: PointReason,
    ref_id: str | None = None,
    balance_after: int = 0,
) -> PointTransaction:
    """写一条积分流水记录。"""
    tx = PointTransaction(
        user_id=user_id,
        type=ptype,
        amount=amount,
        reason=reason,
        ref_id=ref_id,
        balance_after=balance_after,
    )
    db.add(tx)
    return tx


def _compute_afdian_sign(token: str, params: str, ts: int, user_id: str) -> str:
    """计算爱发电 API 签名。

    sign = md5(token + "params" + params + "ts" + str(ts) + "user_id" + user_id)
    """
    raw = f"{token}params{params}ts{ts}user_id{user_id}"
    return hashlib.md5(raw.encode()).hexdigest()


async def _query_afdian_order(out_trade_no: str) -> dict | None:
    """调用爱发电 query-order API 查询订单。"""
    ts = int(time.time())
    params = json.dumps({"out_trade_no": out_trade_no})
    sign = _compute_afdian_sign(settings.afdian_token, params, ts, settings.afdian_user_id)

    payload = {
        "user_id": settings.afdian_user_id,
        "params": params,
        "ts": ts,
        "sign": sign,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://afdian.net/api/open/query-order",
            json=payload,
        )
        data = resp.json()

    if data.get("ec") != 200:
        return None

    order_list = data.get("data", {}).get("list", [])
    for order in order_list:
        if order.get("out_trade_no") == out_trade_no:
            return order
    return None


async def _process_afdian_order(
    db: AsyncSession, order: dict, user_id: int
) -> dict:
    """处理爱发电订单：充值贝壳积分。"""
    out_trade_no = order.get("out_trade_no", "")
    status = order.get("status")
    total_amount = order.get("total_amount", "0")

    if status != 2:
        raise HTTPException(status_code=400, detail="订单未完成支付")

    # 检查是否已处理过
    existing_tx = (
        await db.execute(
            select(PointTransaction).where(
                PointTransaction.ref_id == out_trade_no,
                PointTransaction.reason == PointReason.RECHARGE,
            )
        )
    ).scalar_one_or_none()
    if existing_tx:
        raise HTTPException(status_code=409, detail="该订单已处理过")

    # 计算充值数量：1 元 = 1 贝壳积分
    recharge_amount = int(float(total_amount))
    if recharge_amount <= 0:
        raise HTTPException(status_code=400, detail="订单金额无效")

    acct = await _get_or_create_account(db, user_id)
    acct.shell_points += recharge_amount

    await _add_transaction(
        db,
        user_id=user_id,
        ptype=PointType.SHELL,
        amount=recharge_amount,
        reason=PointReason.RECHARGE,
        ref_id=out_trade_no,
        balance_after=acct.shell_points,
    )
    await db.commit()
    await db.refresh(acct)
    return {"ok": True, "recharged": recharge_amount, "shell_points": acct.shell_points}


# ──────────────── Pydantic schemas ────────────────

class AccountOut(BaseModel):
    pixel_points: int
    shell_points: int
    last_checkin: str | None


class CheckinOut(BaseModel):
    ok: bool
    pixel_points: int
    message: str


class TransactionOut(BaseModel):
    id: int
    type: str
    amount: int
    reason: str
    ref_id: str | None
    balance_after: int
    created_at: str | None


class VerifyAfdianBody(BaseModel):
    out_trade_no: str


# ──────────────── 用户：积分查询 ────────────────

@router.get("/account", response_model=AccountOut)
async def get_account(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    acct = await _get_or_create_account(db, user.id)
    return AccountOut(
        pixel_points=acct.pixel_points,
        shell_points=acct.shell_points,
        last_checkin=acct.last_checkin.isoformat() if acct.last_checkin else None,
    )


# ──────────────── 用户：每日签到 ────────────────

@router.post("/checkin", response_model=CheckinOut)
async def daily_checkin(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    acct = await _get_or_create_account(db, user.id)

    now_bj = datetime.now(BJ_TZ)
    today_bj = now_bj.date()

    if acct.last_checkin:
        last_checkin_date = acct.last_checkin.astimezone(BJ_TZ).date()
        if last_checkin_date >= today_bj:
            raise HTTPException(status_code=409, detail="今天已签到")

    # +2 像素积分
    acct.pixel_points += 2
    acct.last_checkin = now_bj

    await _add_transaction(
        db,
        user_id=user.id,
        ptype=PointType.PIXEL,
        amount=2,
        reason=PointReason.CHECKIN,
        balance_after=acct.pixel_points,
    )
    await db.commit()
    await db.refresh(acct)

    return CheckinOut(
        ok=True,
        pixel_points=acct.pixel_points,
        message="签到成功，获得 2 像素积分",
    )


# ──────────────── 用户：积分流水 ────────────────

@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(PointTransaction).where(PointTransaction.user_id == user.id)
    if type in ("pixel", "shell"):
        q = q.where(PointTransaction.type == type)
    q = q.order_by(PointTransaction.created_at.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    rows = (await db.execute(q)).scalars().all()
    return [TransactionOut(**tx.to_dict()) for tx in rows]


# ──────────────── 用户：确认爱发电购买 ────────────────

@router.post("/verify-afdian")
async def verify_afdian(
    body: VerifyAfdianBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """用户点击"确认已购买"后，调用爱发电 API 查询订单并充值。"""
    order = await _query_afdian_order(body.out_trade_no)
    if not order:
        raise HTTPException(status_code=404, detail="未找到该订单")

    return await _process_afdian_order(db, order, user.id)


# ──────────────── 公开：爱发电 webhook ────────────────

@router.post("/webhook/afdian")
async def afdian_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """爱发电 webhook 回调。

    爱发电发送订单通知到此端点。需要返回 {"ec": 200}。
    """
    ec = body.get("ec")
    if ec != 200:
        return {"ec": 400, "em": "invalid request"}

    data = body.get("data", {})
    data_type = data.get("type")

    if data_type == "order":
        order_data = data.get("order", {})
        out_trade_no = order_data.get("out_trade_no", "")
        afdian_user_id = order_data.get("user_id", "")
        status = order_data.get("status")
        total_amount = order_data.get("total_amount", "0")

        if status != 2:
            # 订单未支付，忽略
            return {"ec": 200}

        # 检查是否已处理
        existing_tx = (
            await db.execute(
                select(PointTransaction).where(
                    PointTransaction.ref_id == out_trade_no,
                    PointTransaction.reason == PointReason.RECHARGE,
                )
            )
        ).scalar_one_or_none()
        if existing_tx:
            return {"ec": 200}

        # 查找爱发电用户对应的平台用户
        # 由于 webhook 不携带平台 user_id，我们需要通过 afdian_user_id 关联
        # 目前简单处理：在 order remark 或 sku_detail 中查找平台用户信息
        # 如果找不到，记录日志待后续手动处理
        # 这里我们尝试通过订单备注或先查所有用户来找匹配
        # 实际方案：用户在爱发电下单时备注平台用户名
        # 此处先记录未处理的订单，等待用户自己来 verify-afdian 确认

        # 写一条待认领的流水（user_id=0 表示待认领）
        # 实际上更好的做法是：webhook 只做记录，用户 verify 时真正处理
        # 这里先简单返回成功，让用户自己来 verify-afdian 触发处理
        pass

    return {"ec": 200}
