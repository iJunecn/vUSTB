"""3D 打印预约系统 API。

公开接口：打印机状态、预约时间表
用户接口：创建/取消/签到预约
管理接口（super_admin / admin / teacher）：审批、打印机管理、报表导出
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, get_current_admin
from app.models import (
    User, UserGroup,
    Printer3D, Booking, BookingStatus, SlotType, PrintType, WeeklyReport,
)
from app.utils.user_groups import is_admin_group

router = APIRouter(prefix="/api/print", tags=["print-booking"])

# ──────────────── helpers ────────────────

def _can_manage_printer(user: User) -> bool:
    return user.user_group in (UserGroup.SUPER_ADMIN, UserGroup.ADMIN, UserGroup.TEACHER)


def _cost(own_filament: bool, print_type: PrintType, weight: float) -> float:
    if own_filament:
        return 0.0
    unit = 0.15 if print_type == PrintType.MULTI else 0.10
    return round(weight * unit, 2)


# ──────────────── Pydantic schemas ────────────────

class PrinterOut(BaseModel):
    id: int
    name: str
    location: str | None
    model: str | None
    is_paused: bool


class PrinterCreate(BaseModel):
    name: str = Field(..., max_length=128)
    location: str | None = None
    model: str | None = None
    is_paused: bool = False


class PrinterUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    model: str | None = None
    is_paused: bool | None = None


class BookingCreate(BaseModel):
    printer_id: int | None = None
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    slot_type: SlotType
    own_filament: bool = False
    print_type: PrintType = PrintType.SINGLE
    weight: float = Field(default=0, ge=0)
    file_name: str | None = None
    purpose: str | None = None
    is_paid: bool = False


class BookingUpdate(BaseModel):
    own_filament: bool | None = None
    print_type: PrintType | None = None
    weight: float | None = None
    is_paid: bool | None = None
    file_name: str | None = None
    purpose: str | None = None
    status: BookingStatus | None = None


class BookingOut(BaseModel):
    id: int
    user_id: int
    printer_id: int | None
    date: str
    slot_type: str
    own_filament: bool
    print_type: str
    weight: float
    cost: float
    file_name: str | None
    purpose: str | None
    is_paid: bool
    status: str
    rejection_reason: str | None
    created_at: str | None
    # joined
    username: str | None = None
    real_name: str | None = None
    student_id: str | None = None


class RejectBody(BaseModel):
    reason: str = ""


# ──────────────── 公开：打印机状态 ────────────────

@router.get("/printers", response_model=list[PrinterOut])
async def list_printers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Printer3D).order_by(Printer3D.id))).scalars().all()
    return [
        PrinterOut(id=p.id, name=p.name, location=p.location, model=p.model, is_paused=p.is_paused)
        for p in rows
    ]


@router.get("/printers/{printer_id}/status")
async def printer_status(printer_id: int, db: AsyncSession = Depends(get_db)):
    printer = (await db.execute(select(Printer3D).where(Printer3D.id == printer_id))).scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="打印机不存在")

    now = datetime.now(timezone(timedelta(hours=8)))
    today = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    logic_status = "空闲"
    css_class = "idle"

    if printer.is_paused:
        logic_status = "暂停使用"
        css_class = "paused"
    else:
        current_slot = None
        if "08:00" <= current_time <= "11:30":
            current_slot = SlotType.AM
        elif "13:30" <= current_time <= "17:00":
            current_slot = SlotType.PM

        if current_slot:
            booking = (
                await db.execute(
                    select(Booking).where(
                        Booking.printer_id == printer_id,
                        Booking.date == today,
                        Booking.slot_type == current_slot,
                        Booking.status.in_([BookingStatus.BOOKED, BookingStatus.RUNNING, BookingStatus.PENDING]),
                    )
                )
            ).scalar_one_or_none()
            if booking:
                if booking.status == BookingStatus.RUNNING:
                    logic_status = "正在运行"
                    css_class = "running"
                else:
                    logic_status = "已预约"
                    css_class = "reserved"

    return {
        "id": printer.id,
        "name": printer.name,
        "status": logic_status,
        "status_class": css_class,
        "is_paused": printer.is_paused,
    }


# ──────────────── 管理员：打印机 CRUD ────────────────

@router.post("/printers", response_model=PrinterOut)
async def create_printer(
    body: PrinterCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    p = Printer3D(**body.model_dump())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return PrinterOut(id=p.id, name=p.name, location=p.location, model=p.model, is_paused=p.is_paused)


@router.put("/printers/{printer_id}", response_model=PrinterOut)
async def update_printer(
    printer_id: int,
    body: PrinterUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    p = (await db.execute(select(Printer3D).where(Printer3D.id == printer_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="打印机不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return PrinterOut(id=p.id, name=p.name, location=p.location, model=p.model, is_paused=p.is_paused)


@router.delete("/printers/{printer_id}")
async def delete_printer(
    printer_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    p = (await db.execute(select(Printer3D).where(Printer3D.id == printer_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="打印机不存在")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


# ──────────────── 用户：预约 ────────────────

@router.get("/bookings", response_model=list[BookingOut])
async def list_bookings(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    mine: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取预约列表。mine=true 只返回当前用户的。"""
    q = select(Booking, User).join(User, Booking.user_id == User.id, isouter=True)
    if mine:
        q = q.where(Booking.user_id == user.id)
    if date_from:
        q = q.where(Booking.date >= date_from)
    if date_to:
        q = q.where(Booking.date <= date_to)
    q = q.order_by(Booking.date.desc(), Booking.slot_type.desc())

    rows = (await db.execute(q)).all()
    result = []
    for booking, u in rows:
        d = booking.to_dict()
        d["username"] = u.username if u else None
        d["real_name"] = u.real_name if u else None
        d["student_id"] = u.student_id if u else None
        result.append(BookingOut(**d))
    return result


@router.post("/bookings", response_model=BookingOut)
async def create_booking(
    body: BookingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 检查打印机是否暂停
    if body.printer_id:
        printer = (await db.execute(select(Printer3D).where(Printer3D.id == body.printer_id))).scalar_one_or_none()
        if not printer:
            raise HTTPException(status_code=404, detail="打印机不存在")
        if printer.is_paused:
            raise HTTPException(status_code=400, detail="打印机暂停使用中，无法预约")

    # 冲突检查：同一打印机（或无打印机时同一时段全局）不可重复
    conflict_q = select(Booking).where(
        Booking.date == body.date,
        Booking.slot_type == body.slot_type,
        Booking.status.in_([BookingStatus.PENDING, BookingStatus.BOOKED, BookingStatus.RUNNING]),
    )
    if body.printer_id:
        conflict_q = conflict_q.where(Booking.printer_id == body.printer_id)
    else:
        conflict_q = conflict_q.where(Booking.printer_id.is_(None))
    existing = (await db.execute(conflict_q)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="该时段已被预约")

    cost = _cost(body.own_filament, body.print_type, body.weight)

    booking = Booking(
        user_id=user.id,
        printer_id=body.printer_id,
        date=body.date,
        slot_type=body.slot_type,
        own_filament=body.own_filament,
        print_type=body.print_type,
        weight=body.weight if not body.own_filament else 0,
        cost=cost,
        file_name=body.file_name,
        purpose=body.purpose,
        is_paid=body.is_paid,
        status=BookingStatus.PENDING,
    )
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    d = booking.to_dict()
    d.update({"username": user.username, "real_name": user.real_name, "student_id": user.student_id})
    return BookingOut(**d)


@router.get("/bookings/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking, u = (
        await db.execute(
            select(Booking, User).join(User, Booking.user_id == User.id).where(Booking.id == booking_id)
        )
    ).first() or (None, None)
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    if booking.user_id != user.id and not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="无权查看")
    d = booking.to_dict()
    d.update({"username": u.username if u else None, "real_name": u.real_name if u else None, "student_id": u.student_id if u else None})
    return BookingOut(**d)


@router.put("/bookings/{booking_id}", response_model=BookingOut)
async def update_booking(
    booking_id: int,
    body: BookingUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    if booking.user_id != user.id and not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="无权操作")

    updates = body.model_dump(exclude_unset=True)

    # Recalculate cost if relevant fields changed
    own_filament = updates.get("own_filament", booking.own_filament)
    print_type = updates.get("print_type", booking.print_type)
    weight = updates.get("weight", booking.weight)

    for k, v in updates.items():
        setattr(booking, k, v)

    if not booking.own_filament:
        booking.weight = weight
        booking.cost = _cost(booking.own_filament, booking.print_type, booking.weight)
    else:
        booking.weight = 0
        booking.cost = 0.0

    await db.commit()
    await db.refresh(booking)

    u = (await db.execute(select(User).where(User.id == booking.user_id))).scalar_one_or_none()
    d = booking.to_dict()
    d.update({"username": u.username if u else None, "real_name": u.real_name if u else None, "student_id": u.student_id if u else None})
    return BookingOut(**d)


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    if booking.user_id != user.id and not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="无权操作")
    booking.status = BookingStatus.CANCELLED
    await db.commit()
    return {"ok": True}


@router.post("/bookings/{booking_id}/checkin")
async def checkin_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    if booking.user_id != user.id and not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="无法操作")

    if not _can_manage_printer(user):
        start_clock = "08:00" if booking.slot_type == SlotType.AM else "13:30"
        start_moment = datetime.strptime(f"{booking.date} {start_clock}", "%Y-%m-%d %H:%M")
        start_moment = start_moment.replace(tzinfo=timezone(timedelta(hours=8)))
        if datetime.now(timezone(timedelta(hours=8))) < start_moment:
            raise HTTPException(status_code=400, detail="未到开始时间，暂不可签到")

    booking.status = BookingStatus.RUNNING
    await db.commit()
    return {"ok": True}


@router.post("/bookings/{booking_id}/complete")
async def complete_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    booking.status = BookingStatus.DONE
    await db.commit()
    return {"ok": True}


# ──────────────── 管理员：审批 ────────────────

@router.get("/admin/approvals", response_model=list[BookingOut])
async def list_pending_approvals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    rows = (
        await db.execute(
            select(Booking, User)
            .join(User, Booking.user_id == User.id)
            .where(Booking.status == BookingStatus.PENDING)
            .order_by(Booking.date.asc(), Booking.slot_type.asc())
        )
    ).all()
    result = []
    for booking, u in rows:
        d = booking.to_dict()
        d.update({"username": u.username, "real_name": u.real_name, "student_id": u.student_id})
        result.append(BookingOut(**d))
    return result


@router.post("/admin/approve/{booking_id}")
async def approve_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    booking.status = BookingStatus.BOOKED
    await db.commit()
    return {"ok": True}


@router.post("/admin/reject/{booking_id}")
async def reject_booking(
    booking_id: int,
    body: RejectBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    booking.status = BookingStatus.REJECTED
    booking.rejection_reason = body.reason
    await db.commit()
    return {"ok": True}


@router.delete("/admin/bookings/{booking_id}")
async def admin_delete_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="预约不存在")
    await db.delete(booking)
    await db.commit()
    return {"ok": True}


# ──────────────── 周报导出 ────────────────

@router.get("/admin/reports/export")
async def export_report(
    date_from: str = Query(...),
    date_to: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    rows = (
        await db.execute(
            select(Booking, User)
            .join(User, Booking.user_id == User.id)
            .where(Booking.date >= date_from, Booking.date <= date_to)
            .order_by(Booking.date.asc(), Booking.slot_type.asc())
        )
    ).all()

    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=500, detail="服务器未安装 openpyxl，无法导出 Excel")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "周报"
    headers = ["预约ID", "用户", "真实姓名", "学号", "日期", "时段", "自带耗材", "打印类型", "重量(g)", "费用(元)", "是否支付", "文件名", "用途", "状态", "创建时间"]
    ws.append(headers)

    for booking, u in rows:
        ws.append([
            booking.id,
            u.username if u else "",
            u.real_name if u else "",
            u.student_id if u else "",
            booking.date,
            booking.slot_type.value,
            "是" if booking.own_filament else "否",
            "多色" if booking.print_type == PrintType.MULTI else "单色",
            booking.weight,
            booking.cost,
            "已支付" if booking.is_paid else "未支付",
            booking.file_name or "",
            booking.purpose or "",
            booking.status.value,
            booking.created_at.isoformat() if booking.created_at else "",
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"print_report_{date_from}_to_{date_to}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/stats")
async def print_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    total_bookings = (await db.execute(select(func.count(Booking.id)))).scalar() or 0
    pending = (await db.execute(select(func.count(Booking.id)).where(Booking.status == BookingStatus.PENDING))).scalar() or 0
    printers = (await db.execute(select(func.count(Printer3D.id)))).scalar() or 0
    return {
        "total_bookings": total_bookings,
        "pending_approvals": pending,
        "printers": printers,
    }


# ──────────────── 周报管理 ────────────────

class WeeklyReportOut(BaseModel):
    id: int
    start_date: str
    end_date: str
    file_path: str | None
    created_at: str | None


@router.get("/admin/reports", response_model=list[WeeklyReportOut])
async def list_weekly_reports(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    rows = (
        await db.execute(select(WeeklyReport).order_by(WeeklyReport.created_at.desc()))
    ).scalars().all()
    return [
        WeeklyReportOut(
            id=r.id,
            start_date=r.start_date,
            end_date=r.end_date,
            file_path=r.file_path,
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]


@router.post("/admin/reports/generate")
async def generate_weekly_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """手动生成本周周报并保存到数据库。"""
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")

    from datetime import timedelta
    now = datetime.now(timezone(timedelta(hours=8)))
    # 本周一到本周日
    monday = now - timedelta(days=now.weekday())
    start_date = monday.strftime("%Y-%m-%d")
    end_date = (monday + timedelta(days=6)).strftime("%Y-%m-%d")

    report = WeeklyReport(start_date=start_date, end_date=end_date)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {
        "id": report.id,
        "start_date": report.start_date,
        "end_date": report.end_date,
        "ok": True,
    }


@router.delete("/admin/reports/{report_id}")
async def delete_weekly_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_manage_printer(user):
        raise HTTPException(status_code=403, detail="需要管理员或教师权限")
    r = (await db.execute(select(WeeklyReport).where(WeeklyReport.id == report_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="周报不存在")
    await db.delete(r)
    await db.commit()
    return {"ok": True}


# ──────────────── 周时间表 ────────────────

@router.get("/schedule")
async def get_weekly_schedule(
    date_from: str = Query(...),
    date_to: str = Query(...),
    printer_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """获取指定日期范围的预约时间表（公开）。"""
    q = select(Booking, User).join(User, Booking.user_id == User.id)
    q = q.where(
        Booking.date >= date_from,
        Booking.date <= date_to,
        Booking.status.in_([BookingStatus.PENDING, BookingStatus.BOOKED, BookingStatus.RUNNING]),
    )
    if printer_id:
        q = q.where(Booking.printer_id == printer_id)
    q = q.order_by(Booking.date.asc(), Booking.slot_type.asc())

    rows = (await db.execute(q)).all()
    result = []
    for booking, u in rows:
        d = booking.to_dict()
        d["username"] = u.username if u else None
        d["real_name"] = u.real_name if u else None
        d["student_id"] = u.student_id if u else None
        result.append(d)
    return result
