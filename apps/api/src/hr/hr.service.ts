import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  HrAttendanceStatus,
  HrLeaveKind,
  HrLeaveStatus,
  HrMovementKind,
  HrPayrollStatus,
  HrRequestStatus,
  HrRequestType,
  InvoiceStatus,
  PayMethodKind,
  Prisma,
  Role,
} from '@prisma/client';
import { normalizeAccess } from '../common/access-map';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import {
  cairoYmd,
  dateOnly,
  DEFAULT_HR_SETTINGS,
  eachYmd,
  egyptMinutesOf,
  employeeHours,
  HR_SETTINGS_KEY,
  isWeekend,
  nextSeq,
  overtimeRates,
  parseHrSettings,
  parseRange,
  roundMoney,
  SALARY_EXPENSE_CATEGORY,
  type HrSettings,
} from './hr.util';

type CalcLineInput = {
  employeeId?: string;
  employeeIds?: string[];
  from: string;
  to: string;
};

@Injectable()
export class HrService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  /** منح hr.request تلقائياً لمستخدمي المبيعات/المخزن القدامى */
  async onModuleInit() {
    try {
      const users = await this.prisma.user.findMany({
        where: { role: { in: [Role.SALES, Role.WAREHOUSE] }, isActive: true },
        select: { id: true, role: true, permissions: true },
      });
      for (const user of users) {
        let access = normalizeAccess(user.permissions ? JSON.parse(user.permissions) : null, user.role);
        if (!access.hr) continue;
        if (access.hr.view && access.hr.actions.includes('request')) continue;
        access = {
          ...access,
          hr: {
            view: true,
            actions: Array.from(new Set([...(access.hr.actions || []), 'request'])),
            fields: access.hr.fields?.length ? access.hr.fields : ['amounts'],
          },
        };
        await this.prisma.user.update({
          where: { id: user.id },
          data: { permissions: JSON.stringify(access) },
        });
      }
    } catch {
      // schema قديم قبل generate — يُتجاهل عند الإقلاع
    }
  }

  // ─── settings ─────────────────────────────────────────────
  async getSettings(): Promise<HrSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: HR_SETTINGS_KEY } });
    return parseHrSettings(row?.value);
  }

  async patchSettings(patch: Partial<HrSettings>) {
    const current = await this.getSettings();
    const absenceMultiplier = Number(patch.absenceMultiplier ?? current.absenceMultiplier);
    const next: HrSettings = {
      ...current,
      ...patch,
      daysPerMonth: Math.max(1, Number(patch.daysPerMonth ?? current.daysPerMonth)),
      hoursPerDay: Math.max(1, Number(patch.hoursPerDay ?? current.hoursPerDay)),
      weekendDays: Array.isArray(patch.weekendDays)
        ? patch.weekendDays.map(Number).filter((d) => d >= 0 && d <= 6)
        : current.weekendDays,
      lateGraceMinutes: Math.max(0, Number(patch.lateGraceMinutes ?? current.lateGraceMinutes)),
      latePenaltyPerMinute: Math.max(0, Number(patch.latePenaltyPerMinute ?? current.latePenaltyPerMinute)),
      permissionDeductPerHour: Math.max(0, Number(patch.permissionDeductPerHour ?? current.permissionDeductPerHour)),
      workStartHour: Math.min(23, Math.max(0, Number(patch.workStartHour ?? current.workStartHour))),
      workStartMinute: Math.min(59, Math.max(0, Number(patch.workStartMinute ?? current.workStartMinute))),
      overtimeMultiplier: Math.max(1, Number(patch.overtimeMultiplier ?? current.overtimeMultiplier)),
      absenceMultiplier: absenceMultiplier === 2 ? 2 : 1,
      unpaidLeaveDeduct: patch.unpaidLeaveDeduct ?? current.unpaidLeaveDeduct,
      lateByHourlyRate: patch.lateByHourlyRate ?? current.lateByHourlyRate,
    };
    await this.prisma.setting.upsert({
      where: { key: HR_SETTINGS_KEY },
      create: { key: HR_SETTINGS_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  // ─── holidays ─────────────────────────────────────────────
  listHolidays() {
    return this.prisma.hrHoliday.findMany({ orderBy: { date: 'asc' } });
  }

  async createHoliday(data: { date: string; name: string }) {
    const date = dateOnly(data.date);
    try {
      return await this.prisma.hrHoliday.create({
        data: { date, name: data.name.trim() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('هذا اليوم مسجل كإجازة رسمية بالفعل');
      }
      throw e;
    }
  }

  async deleteHoliday(id: string) {
    await this.prisma.hrHoliday.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الإجازة غير موجودة');
    });
    return { ok: true };
  }

  // ─── employees ────────────────────────────────────────────
  listEmployees(q?: string) {
    const where: Prisma.HrEmployeeWhereInput = q
      ? {
          OR: [
            { code: { contains: q } },
            { name: { contains: q } },
            { phone: { contains: q } },
          ],
        }
      : {};
    return this.prisma.hrEmployee.findMany({
      where,
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async getEmployee(id: string) {
    const row = await this.prisma.hrEmployee.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
    });
    if (!row) throw new NotFoundException('الموظف غير موجود');
    return row;
  }

  async createEmployee(data: {
    code?: string;
    name: string;
    userId?: string | null;
    salary?: number;
    commissionPercent?: number;
    phone?: string;
    hireDate?: string;
    workHours?: number | null;
    notes?: string;
    isActive?: boolean;
  }) {
    const code = (data.code || '').trim() || `E${Date.now().toString(36).toUpperCase()}`;
    const name = data.name.trim();
    if (!name) throw new BadRequestException('اسم الموظف مطلوب');
    if (data.userId) await this.assertUserLinkable(data.userId);
    try {
      return await this.prisma.hrEmployee.create({
        data: {
          code,
          name,
          userId: data.userId || null,
          salary: Math.max(0, Number(data.salary) || 0),
          commissionPercent: Math.max(0, Number(data.commissionPercent) || 0),
          phone: data.phone?.trim() || null,
          hireDate: data.hireDate ? dateOnly(data.hireDate) : null,
          workHours: Number(data.workHours) > 0 ? Number(data.workHours) : null,
          notes: data.notes?.trim() || null,
          isActive: data.isActive !== false,
        },
        include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('كود الموظف أو المستخدم مربوط مسبقاً');
      }
      throw e;
    }
  }

  async updateEmployee(
    id: string,
    data: Partial<{
      code: string;
      name: string;
      userId: string | null;
      salary: number;
      commissionPercent: number;
      phone: string | null;
      hireDate: string | null;
      workHours: number | null;
      notes: string | null;
      isActive: boolean;
    }>,
  ) {
    await this.getEmployee(id);
    if (data.userId) await this.assertUserLinkable(data.userId, id);
    try {
      return await this.prisma.hrEmployee.update({
        where: { id },
        data: {
          ...(data.code != null ? { code: data.code.trim() } : {}),
          ...(data.name != null ? { name: data.name.trim() } : {}),
          ...(data.userId !== undefined ? { userId: data.userId || null } : {}),
          ...(data.salary != null ? { salary: Math.max(0, Number(data.salary) || 0) } : {}),
          ...(data.commissionPercent != null
            ? { commissionPercent: Math.max(0, Number(data.commissionPercent) || 0) }
            : {}),
          ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
          ...(data.hireDate !== undefined
            ? { hireDate: data.hireDate ? dateOnly(data.hireDate) : null }
            : {}),
          ...(data.workHours !== undefined
            ? { workHours: Number(data.workHours) > 0 ? Number(data.workHours) : null }
            : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
        },
        include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('كود الموظف أو المستخدم مربوط مسبقاً');
      }
      throw e;
    }
  }

  async deleteEmployee(id: string) {
    const lines = await this.prisma.hrPayrollLine.count({ where: { employeeId: id } });
    if (lines) throw new BadRequestException('لا يمكن حذف موظف له كشوف مرتبات');
    await this.prisma.hrEmployee.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الموظف غير موجود');
    });
    return { ok: true };
  }

  async linkableUsers() {
    const linked = await this.prisma.hrEmployee.findMany({
      where: { userId: { not: null } },
      select: { userId: true },
    });
    const used = new Set(linked.map((r) => r.userId!).filter(Boolean));
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({ ...u, linked: used.has(u.id) }));
  }

  private async assertUserLinkable(userId: string, exceptEmployeeId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new BadRequestException('المستخدم غير موجود أو موقوف');
    const other = await this.prisma.hrEmployee.findFirst({
      where: { userId, ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}) },
    });
    if (other) throw new BadRequestException('هذا المستخدم مربوط بموظف آخر');
  }

  // ─── leaves ───────────────────────────────────────────────
  listLeaves(employeeId?: string) {
    return this.prisma.hrLeave.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        status: HrLeaveStatus.APPROVED,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: { fromDate: 'desc' },
    });
  }

  async createLeave(data: {
    employeeId: string;
    fromDate: string;
    toDate: string;
    kind?: HrLeaveKind;
    hours?: number;
    notes?: string;
  }) {
    await this.getEmployee(data.employeeId);
    const { fromDate, toDate } = parseRange(data.fromDate, data.toDate);
    const kind = data.kind || HrLeaveKind.PAID;
    return this.prisma.hrLeave.create({
      data: {
        employeeId: data.employeeId,
        fromDate,
        toDate,
        kind,
        status: HrLeaveStatus.APPROVED,
        hours: kind === HrLeaveKind.PERMISSION && Number(data.hours) > 0 ? Number(data.hours) : null,
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteLeave(id: string) {
    await this.prisma.hrLeave.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الإجازة غير موجودة');
    });
    return { ok: true };
  }

  // ─── movements ────────────────────────────────────────────
  listMovements(query?: { employeeId?: string; unsettled?: string; from?: string; to?: string }) {
    const where: Prisma.HrMovementWhereInput = {};
    if (query?.employeeId) where.employeeId = query.employeeId;
    if (query?.unsettled === '1') where.payrollRunId = null;
    if (query?.from || query?.to) {
      where.movementDate = {};
      if (query.from) where.movementDate.gte = dateOnly(query.from);
      if (query.to) where.movementDate.lte = dateOnly(query.to);
    }
    return this.prisma.hrMovement.findMany({
      where,
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: { movementDate: 'desc' },
    });
  }

  async createMovement(data: {
    employeeId: string;
    kind: HrMovementKind;
    amount: number;
    movementDate?: string;
    notes?: string;
  }) {
    await this.getEmployee(data.employeeId);
    if (!Object.values(HrMovementKind).includes(data.kind)) {
      throw new BadRequestException('نوع الحركة غير صالح');
    }
    const amount = roundMoney(Math.abs(Number(data.amount) || 0));
    if (amount <= 0) throw new BadRequestException('المبلغ لازم يكون أكبر من صفر');
    return this.prisma.hrMovement.create({
      data: {
        employeeId: data.employeeId,
        kind: data.kind,
        amount,
        movementDate: data.movementDate ? dateOnly(data.movementDate) : dateOnly(new Date()),
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteMovement(id: string) {
    const row = await this.prisma.hrMovement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('الحركة غير موجودة');
    if (row.payrollRunId) throw new BadRequestException('الحركة مسوّاة ضمن كشف مرتبات ولا تُحذف');
    await this.prisma.hrMovement.delete({ where: { id } });
    return { ok: true };
  }

  // ─── attendance ───────────────────────────────────────────
  async listAttendance(query?: { from?: string; to?: string; employeeId?: string }) {
    const where: Prisma.HrAttendanceWhereInput = {};
    if (query?.employeeId) where.employeeId = query.employeeId;
    if (query?.from || query?.to) {
      where.workDate = {};
      if (query.from) where.workDate.gte = dateOnly(query.from);
      if (query.to) where.workDate.lte = dateOnly(query.to);
    }
    const [rows, settings] = await Promise.all([
      this.prisma.hrAttendance.findMany({
        where,
        include: { employee: { select: { id: true, code: true, name: true, salary: true, workHours: true } } },
        orderBy: [{ workDate: 'desc' }, { employee: { code: 'asc' } }],
      }),
      this.getSettings(),
    ]);
    return rows.map(({ employee, ...row }) => ({
      ...row,
      employee: { id: employee.id, code: employee.code, name: employee.name },
      overtime: this.overtimeInfo(employee, settings, row.overtimeMinutes),
    }));
  }

  async upsertAttendance(data: {
    employeeId: string;
    workDate: string;
    status?: HrAttendanceStatus;
    punchIn?: string | null;
    punchOut?: string | null;
    lateMinutes?: number;
    permissionMinutes?: number;
    overtimeMinutes?: number;
    overtimeApproved?: boolean;
    notes?: string;
  }) {
    const employee = await this.getEmployee(data.employeeId);
    const workDate = dateOnly(data.workDate);
    const settings = await this.getSettings();
    const existing = await this.prisma.hrAttendance.findUnique({
      where: { employeeId_workDate: { employeeId: data.employeeId, workDate } },
    });
    let lateMinutes = Math.max(0, Number(data.lateMinutes) || 0);
    let permissionMinutes = Math.max(0, Number(data.permissionMinutes) || 0);
    let overtimeMinutes = Math.max(0, Number(data.overtimeMinutes) || 0);
    let punchIn: Date | null = data.punchIn ? new Date(data.punchIn) : null;
    let punchOut: Date | null = data.punchOut ? new Date(data.punchOut) : null;
    if (punchIn && Number.isNaN(punchIn.getTime())) punchIn = null;
    if (punchOut && Number.isNaN(punchOut.getTime())) punchOut = null;

    // لو الحضور/الانصراف موجودين ومتبعتش إضافي يدوي → احسب ساعات العمل والإضافي
    if (punchIn && punchOut && (data.overtimeMinutes == null || data.overtimeMinutes === undefined)) {
      const workedMins = Math.max(0, Math.round((punchOut.getTime() - punchIn.getTime()) / 60000));
      const expectedMins = Math.max(1, employeeHours(employee, settings)) * 60;
      overtimeMinutes = Math.max(0, workedMins - expectedMins);
    }
    // الإضافي يحتاج تأكيد — يفضل مؤكد فقط لو نفس الدقائق اللي اتأكدت قبل كده
    const overtimeApproved = overtimeMinutes > 0 && (
      data.overtimeApproved ?? (!!existing?.overtimeApproved && existing.overtimeMinutes === overtimeMinutes)
    );

    let status = data.status || HrAttendanceStatus.PRESENT;
    if (punchIn && (data.lateMinutes == null || data.lateMinutes === undefined)) {
      lateMinutes = this.calcLateMinutes(punchIn, workDate, settings);
    }
    // lateMinutes مخزّن بعد خصم فترة السماح
    if (status === HrAttendanceStatus.PRESENT && lateMinutes > 0) {
      status = HrAttendanceStatus.LATE;
    }

    const row = await this.prisma.hrAttendance.upsert({
      where: { employeeId_workDate: { employeeId: data.employeeId, workDate } },
      create: {
        employeeId: data.employeeId,
        workDate,
        status,
        punchIn,
        punchOut,
        lateMinutes,
        permissionMinutes,
        overtimeMinutes,
        overtimeApproved,
        notes: data.notes?.trim() || null,
      },
      update: {
        status,
        punchIn,
        punchOut,
        lateMinutes,
        permissionMinutes,
        overtimeMinutes,
        overtimeApproved,
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
    return { ...row, overtime: this.overtimeInfo(employee, settings, overtimeMinutes) };
  }

  private overtimeInfo(
    employee: { salary: number; workHours?: number | null },
    settings: HrSettings,
    minutes: number,
  ) {
    const { hourlyRate, overtimeRate } = overtimeRates(employee, settings);
    const hours = roundMoney(minutes / 60);
    return {
      hours,
      workHours: employeeHours(employee, settings),
      hourlyRate,
      multiplier: settings.overtimeMultiplier,
      rate: overtimeRate,
      amount: roundMoney(hours * overtimeRate),
    };
  }

  async approveOvertime(id: string, approved: boolean) {
    const row = await this.prisma.hrAttendance.findUnique({ where: { id }, include: { employee: true } });
    if (!row) throw new NotFoundException('سجل الحضور غير موجود');
    if (approved && row.overtimeMinutes <= 0) throw new BadRequestException('لا يوجد إضافي في هذا اليوم');
    const updated = await this.prisma.hrAttendance.update({
      where: { id },
      data: { overtimeApproved: approved },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
    const settings = await this.getSettings();
    return { ...updated, overtime: this.overtimeInfo(row.employee, settings, row.overtimeMinutes) };
  }

  async deleteAttendance(id: string) {
    await this.prisma.hrAttendance.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('سجل الحضور غير موجود');
    });
    return { ok: true };
  }

  async punchIn(employeeId: string, at?: string) {
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('وقت غير صالح');
    const ymd = cairoYmd(when);
    const settings = await this.getSettings();
    const workDate = dateOnly(ymd);
    const lateMinutes = this.calcLateMinutes(when, workDate, settings);
    const status = lateMinutes > 0 ? HrAttendanceStatus.LATE : HrAttendanceStatus.PRESENT;
    return this.upsertAttendance({
      employeeId,
      workDate: ymd,
      punchIn: when.toISOString(),
      status,
      lateMinutes,
    });
  }

  async punchOut(employeeId: string, at?: string) {
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('وقت غير صالح');
    const ymd = cairoYmd(when);
    const existing = await this.prisma.hrAttendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: dateOnly(ymd) } },
    });
    if (!existing?.punchIn) {
      throw new BadRequestException('لا يوجد تسجيل حضور لهذا اليوم');
    }
    return this.upsertAttendance({
      employeeId,
      workDate: ymd,
      punchIn: existing.punchIn.toISOString(),
      punchOut: when.toISOString(),
      status: existing.status,
      lateMinutes: existing.lateMinutes,
      permissionMinutes: existing.permissionMinutes,
      notes: existing.notes || undefined,
    });
  }

  private calcLateMinutes(punchIn: Date, workDate: Date, settings: HrSettings) {
    const ymd = cairoYmd(workDate);
    const start = new Date(
      `${ymd}T${String(settings.workStartHour).padStart(2, '0')}:${String(settings.workStartMinute).padStart(2, '0')}:00`,
    );
    // interpret work start in local/Cairo wall clock approx via ISO without Z → local; fallback minutes via cairo parts
    const punchMins = egyptMinutesOf(punchIn);
    const startMins = settings.workStartHour * 60 + settings.workStartMinute;
    const diff = punchMins - startMins - settings.lateGraceMinutes;
    return Math.max(0, diff);
    void start;
  }

  // ─── commission report ────────────────────────────────────
  async commissionsReport(from?: string, to?: string) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(
      from || cairoYmd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      to || cairoYmd(new Date()),
    );
    const employees = await this.prisma.hrEmployee.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, fullName: true, username: true } } },
      orderBy: { code: 'asc' },
    });
    const rows = [];
    for (const emp of employees) {
      const salesTotal = await this.salesTotalFor(emp.userId, fromDate, toDate);
      const commissionEarned = roundMoney(salesTotal * ((emp.commissionPercent || 0) / 100));
      const paid = await this.commissionPaidExact(emp.id, fromDate, toDate);
      const remaining = roundMoney(Math.max(0, commissionEarned - paid));
      const commissionDue = remaining;
      rows.push({
        employeeId: emp.id,
        name: emp.name,
        code: emp.code,
        commissionPercent: emp.commissionPercent,
        salesTotal,
        commissionEarned,
        commissionPaid: paid,
        commissionRemaining: remaining,
        commissionDue,
        linked: !!emp.userId,
        userName: emp.user?.fullName || null,
        from: fromYmd,
        to: toYmd,
      });
    }

    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        createdById: { not: null },
      },
      select: { createdById: true, total: true, number: true, invoiceDate: true },
    });
    const linkedUserIds = new Set(employees.map((e) => e.userId).filter(Boolean) as string[]);
    const unlinkedByUser = new Map<string, { salesTotal: number; count: number }>();
    for (const inv of invoices) {
      if (!inv.createdById || linkedUserIds.has(inv.createdById)) continue;
      const cur = unlinkedByUser.get(inv.createdById) || { salesTotal: 0, count: 0 };
      cur.salesTotal += inv.total;
      cur.count += 1;
      unlinkedByUser.set(inv.createdById, cur);
    }
    const users = unlinkedByUser.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...unlinkedByUser.keys()] } },
          select: { id: true, fullName: true, username: true },
        })
      : [];
    const unlinkedSales = users.map((u) => ({
      userId: u.id,
      name: u.fullName,
      username: u.username,
      salesTotal: roundMoney(unlinkedByUser.get(u.id)?.salesTotal || 0),
      invoiceCount: unlinkedByUser.get(u.id)?.count || 0,
      hint: 'اربط هذا المستخدم ببطاقة موظف لتدخل مبيعاته في العمولة',
    }));

    return { from: fromYmd, to: toYmd, rows, unlinkedSales };
  }

  listCommissionPayments(employeeId?: string) {
    return this.prisma.hrCommissionPayment.findMany({
      where: employeeId ? { employeeId } : {},
      include: {
        employee: { select: { id: true, code: true, name: true } },
        payrollRun: { select: { id: true, number: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** ممنوع صرف العمولة منفصلاً */
  payCommissionAlone() {
    throw new BadRequestException('الصرف صار ضمن كشف المرتبات فقط');
  }

  async employeeSalesReport(from?: string, to?: string) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(
      from || cairoYmd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      to || cairoYmd(new Date()),
    );
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        createdById: { not: null },
      },
      select: { createdById: true, total: true },
    });
    const byUser = new Map<string, number>();
    for (const inv of invoices) {
      if (!inv.createdById) continue;
      byUser.set(inv.createdById, (byUser.get(inv.createdById) || 0) + inv.total);
    }
    const employees = await this.prisma.hrEmployee.findMany({
      where: { userId: { not: null } },
      include: { user: { select: { id: true, fullName: true, username: true } } },
    });
    const empByUser = new Map(employees.map((e) => [e.userId!, e]));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, fullName: true, username: true },
    });
    const rows = users.map((u) => {
      const emp = empByUser.get(u.id);
      return {
        userId: u.id,
        name: emp?.name || u.fullName,
        code: emp?.code || u.username,
        employeeId: emp?.id || null,
        salesTotal: roundMoney(byUser.get(u.id) || 0),
        fromHr: !!emp,
      };
    });
    rows.sort((a, b) => b.salesTotal - a.salesTotal);
    return { from: fromYmd, to: toYmd, rows };
  }

  private async salesTotalFor(userId: string | null | undefined, fromDate: Date, toDate: Date) {
    if (!userId) return 0;
    const agg = await this.prisma.salesInvoice.aggregate({
      where: {
        createdById: userId,
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
      },
      _sum: { total: true },
    });
    return roundMoney(agg._sum.total || 0);
  }

  /** مطابقة مدفوع العمولة بالفترة exact from/to */
  private async commissionPaidExact(employeeId: string, fromDate: Date, toDate: Date) {
    const payments = await this.prisma.hrCommissionPayment.findMany({
      where: { employeeId, fromDate, toDate },
      select: { amount: true },
    });
    return roundMoney(payments.reduce((s, p) => s + p.amount, 0));
  }

  // ─── payroll calc ─────────────────────────────────────────
  async calc(input: CalcLineInput) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(input.from, input.to);
    const settings = await this.getSettings();
    const holidayRows = await this.prisma.hrHoliday.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
    });
    const holidaySet = new Set(holidayRows.map((h) => cairoYmd(h.date)));
    const workdays = eachYmd(fromYmd, toYmd).filter(
      (d) => !isWeekend(d, settings.weekendDays) && !holidaySet.has(d),
    );

    const empWhere: Prisma.HrEmployeeWhereInput = { isActive: true };
    if (input.employeeId) empWhere.id = input.employeeId;
    if (input.employeeIds?.length) empWhere.id = { in: input.employeeIds };

    const employees = await this.prisma.hrEmployee.findMany({
      where: empWhere,
      orderBy: { code: 'asc' },
    });

    const covered = await this.findCoveredEmployees(
      employees.map((e) => e.id),
      fromDate,
      toDate,
    );
    const lines = [];
    const skipped: { employeeId: string; code: string; name: string; reason: string }[] = [];
    for (const emp of employees) {
      const hit = covered.get(emp.id);
      if (hit) {
        skipped.push({
          employeeId: emp.id,
          code: emp.code,
          name: emp.name,
          reason: `الموظف موجود بالفعل في كشف ${hit.number} (${hit.status === 'POSTED' ? 'مرحّل' : 'مسودة'}) لنفس الفترة أو فترة متداخلة`,
        });
        continue;
      }
      lines.push(await this.calcEmployeeLine(emp, fromDate, toDate, fromYmd, toYmd, workdays, settings));
    }
    const totalNet = roundMoney(lines.reduce((s, l) => s + l.net, 0));
    return {
      from: fromYmd,
      to: toYmd,
      settings,
      workdayCount: workdays.length,
      periodDays: workdays.length,
      formula:
        'الصافي للصرف = صافي الراتب + العمولة المستحقة · العمولة المستحقة = المتبقي (مستحق − مدفوع)',
      lines,
      skipped,
      totalNet,
    };
  }

  /** موظفون موجودون في كشف DRAFT/POSTED يتداخل مع الفترة */
  private async findCoveredEmployees(employeeIds: string[], fromDate: Date, toDate: Date, excludeRunId?: string) {
    if (!employeeIds.length) return new Map<string, { number: string; status: string }>();
    const lines = await this.prisma.hrPayrollLine.findMany({
      where: {
        employeeId: { in: employeeIds },
        run: {
          ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
          status: { in: [HrPayrollStatus.DRAFT, HrPayrollStatus.POSTED] },
          fromDate: { lte: toDate },
          toDate: { gte: fromDate },
        },
      },
      select: {
        employeeId: true,
        run: { select: { number: true, status: true } },
      },
    });
    const map = new Map<string, { number: string; status: string }>();
    for (const row of lines) {
      if (!map.has(row.employeeId)) {
        map.set(row.employeeId, { number: row.run.number, status: row.run.status });
      }
    }
    return map;
  }

  private async calcEmployeeLine(
    emp: { id: string; code: string; name: string; salary: number; commissionPercent: number; userId: string | null; workHours: number | null },
    fromDate: Date,
    toDate: Date,
    fromYmd: string,
    toYmd: string,
    workdays: string[],
    settings: HrSettings,
  ) {
    const daily = roundMoney((emp.salary || 0) / settings.daysPerMonth);
    const hourlyRate = overtimeRates(emp, settings).hourlyRate;
    const periodPay = roundMoney(daily * workdays.length);

    const [attendance, leaves, movements] = await Promise.all([
      this.prisma.hrAttendance.findMany({
        where: { employeeId: emp.id, workDate: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.hrLeave.findMany({
        where: {
          employeeId: emp.id,
          status: HrLeaveStatus.APPROVED,
          fromDate: { lte: toDate },
          toDate: { gte: fromDate },
        },
      }),
      this.prisma.hrMovement.findMany({
        where: {
          employeeId: emp.id,
          payrollRunId: null,
          movementDate: { gte: fromDate, lte: toDate },
        },
      }),
    ]);

    const attByDay = new Map(attendance.map((a) => [cairoYmd(a.workDate), a]));
    const paidLeaveDaysSet = new Set<string>();
    const unpaidLeaveDaysSet = new Set<string>();
    for (const leave of leaves) {
      for (const d of eachYmd(cairoYmd(leave.fromDate), cairoYmd(leave.toDate))) {
        if (d < fromYmd || d > toYmd) continue;
        if (!workdays.includes(d)) continue;
        if (leave.kind === HrLeaveKind.PAID || leave.kind === HrLeaveKind.ANNUAL) paidLeaveDaysSet.add(d);
        else if (leave.kind === HrLeaveKind.UNPAID) unpaidLeaveDaysSet.add(d);
        // PERMISSION يُحسب بالساعات عبر الحركات/الحضور
      }
    }

    let presentDays = 0;
    let paidLeaveDays = 0;
    let permissionDays = 0;
    let absentDays = 0;
    let unpaidLeaveDays = 0;
    let totalLateMinutes = 0;
    let totalOvertimeMinutes = 0;
    let autoPermissionDeduct = 0;

    for (const d of workdays) {
      if (paidLeaveDaysSet.has(d)) {
        paidLeaveDays += 1;
        continue;
      }
      if (unpaidLeaveDaysSet.has(d)) {
        unpaidLeaveDays += 1;
        continue;
      }
      const att = attByDay.get(d);
      if (!att) {
        absentDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.ABSENT) {
        absentDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.PERMISSION) {
        permissionDays += 1;
        if (att.permissionMinutes > 0 && settings.permissionDeductPerHour > 0) {
          autoPermissionDeduct += (att.permissionMinutes / 60) * settings.permissionDeductPerHour;
        }
        continue;
      }
      if (att.status === HrAttendanceStatus.LEAVE) {
        paidLeaveDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.HOLIDAY) {
        continue;
      }
      presentDays += 1;
      // lateMinutes في الحضور محسوبة بعد grace مسبقاً
      totalLateMinutes += Math.max(0, att.lateMinutes || 0);
      if (att.overtimeApproved) totalOvertimeMinutes += Math.max(0, att.overtimeMinutes || 0);
      if (att.permissionMinutes > 0 && settings.permissionDeductPerHour > 0) {
        autoPermissionDeduct += (att.permissionMinutes / 60) * settings.permissionDeductPerHour;
      }
    }

    let bonuses = 0;
    let deductions = 0;
    let advances = 0;
    let latePenaltyExtra = 0;
    let permissionDeduct = autoPermissionDeduct;
    const movementIds: string[] = [];

    for (const m of movements) {
      movementIds.push(m.id);
      if (m.kind === HrMovementKind.BONUS) bonuses += m.amount;
      else if (m.kind === HrMovementKind.DEDUCTION) deductions += m.amount;
      else if (m.kind === HrMovementKind.ADVANCE) advances += m.amount;
      else if (m.kind === HrMovementKind.LATE) latePenaltyExtra += m.amount;
      else if (m.kind === HrMovementKind.PERMISSION) permissionDeduct += m.amount;
    }

    const lateHours = roundMoney(totalLateMinutes / 60);
    const overtimeHours = roundMoney(totalOvertimeMinutes / 60);
    const overtimePay = roundMoney(overtimeHours * hourlyRate * settings.overtimeMultiplier);
    const absenceDeduct = roundMoney(absentDays * daily * settings.absenceMultiplier);
    const unpaidLeaveDeductAmt = settings.unpaidLeaveDeduct
      ? roundMoney(unpaidLeaveDays * daily)
      : 0;

    let latePenalty = settings.lateByHourlyRate
      ? roundMoney(lateHours * hourlyRate)
      : roundMoney(totalLateMinutes * (settings.latePenaltyPerMinute || 0));
    latePenalty = roundMoney(latePenalty + latePenaltyExtra);

    bonuses = roundMoney(bonuses);
    deductions = roundMoney(deductions);
    advances = roundMoney(advances);
    permissionDeduct = roundMoney(permissionDeduct);

    const earned = roundMoney(periodPay - absenceDeduct - unpaidLeaveDeductAmt + overtimePay);
    const salaryNet = roundMoney(
      earned + bonuses - deductions - advances - latePenalty - permissionDeduct,
    );

    const salesTotal = await this.salesTotalFor(emp.userId, fromDate, toDate);
    const commissionRate = emp.commissionPercent || 0;
    const commissionEarned = roundMoney(salesTotal * (commissionRate / 100));
    const commissionPaidBefore = await this.commissionPaidExact(emp.id, fromDate, toDate);
    const commissionDue = roundMoney(Math.max(0, commissionEarned - commissionPaidBefore));
    const net = roundMoney(salaryNet + commissionDue);

    const netToPay = net;
    return {
      employeeId: emp.id,
      code: emp.code,
      name: emp.name,
      basic: emp.salary,
      salary: emp.salary,
      days: workdays.length,
      periodDays: workdays.length,
      presentDays,
      attendanceDays: presentDays,
      paidLeaveDays,
      leaveDays: paidLeaveDays + unpaidLeaveDays,
      permissionDays,
      absentDays,
      unpaidLeaveDays,
      lateHours,
      lateMinutes: totalLateMinutes,
      daily,
      hourlyRate,
      overtimeHours,
      overtimePay,
      earned,
      bonuses,
      deductions,
      advances,
      latePenalty,
      permissionDeduct,
      permissionDeduction: permissionDeduct,
      salaryNet,
      salesTotal,
      commissionRate,
      commissionEarned,
      commissionPaidBefore,
      commissionDue,
      net,
      netToPay,
      movementIds,
      settingsSnapshot: {
        overtimeMultiplier: settings.overtimeMultiplier,
        absenceMultiplier: settings.absenceMultiplier,
        unpaidLeaveDeduct: settings.unpaidLeaveDeduct,
        hoursPerDay: employeeHours(emp, settings),
      },
    };
  }

  // ─── payroll runs ─────────────────────────────────────────
  private hydratePayrollLine<T extends { detailJson?: string | null; employee?: { code?: string; name?: string } | null }>(line: T) {
    let detail: Record<string, unknown> = {};
    if (line.detailJson) {
      try {
        detail = JSON.parse(line.detailJson) as Record<string, unknown>;
      } catch {
        detail = {};
      }
    }
    return {
      ...line,
      code: line.employee?.code,
      name: line.employee?.name,
      basic: detail.basic,
      days: detail.days,
      periodDays: detail.days,
      lateMinutes: detail.lateMinutes,
      unpaidLeaveDays: detail.unpaidLeaveDays,
      netToPay: detail.netToPay ?? (line as { net?: number }).net,
      settingsSnapshot: detail.settingsSnapshot,
    };
  }

  private hydrateRun<T extends { lines: Array<{ detailJson?: string | null; employee?: { code?: string; name?: string } | null }> }>(run: T) {
    return {
      ...run,
      lines: run.lines.map((line) => this.hydratePayrollLine(line)),
    };
  }

  async listRuns() {
    const runs = await this.prisma.hrPayrollRun.findMany({
      include: {
        lines: {
          include: { employee: { select: { id: true, code: true, name: true } } },
          orderBy: { employee: { code: 'asc' } },
        },
        _count: { select: { lines: true, commissionPayments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return runs.map((run) => this.hydrateRun(run));
  }

  async getRun(id: string) {
    const run = await this.prisma.hrPayrollRun.findUnique({
      where: { id },
      include: {
        lines: {
          include: { employee: { select: { id: true, code: true, name: true } } },
          orderBy: { employee: { code: 'asc' } },
        },
        commissionPayments: true,
      },
    });
    if (!run) throw new NotFoundException('كشف المرتبات غير موجود');
    return this.hydrateRun(run);
  }

  async saveRun(data: {
    from: string;
    to: string;
    methodId?: string;
    notes?: string;
    employeeIds?: string[];
    createdById?: string;
  }) {
    const calc = await this.calc({
      from: data.from,
      to: data.to,
      employeeIds: data.employeeIds,
    });
    if (calc.skipped?.length && !calc.lines.length) {
      throw new BadRequestException(
        `كل الموظفين مستبعدون بسبب تداخل مع كشوف سابقة: ${calc.skipped.map((s) => `${s.name} (${s.reason})`).join(' · ')}`,
      );
    }
    if (!calc.lines.length) throw new BadRequestException('لا يوجد موظفون للحساب');
    const skipNote = calc.skipped?.length
      ? `مستبعدون بسبب تداخل: ${calc.skipped.map((s) => s.name).join('، ')}`
      : '';
    const notes = [data.notes?.trim(), skipNote].filter(Boolean).join(' · ') || null;

    const { fromDate, toDate } = parseRange(data.from, data.to);

    return this.prisma.$transaction(async (tx) => {
      const number = await nextSeq(tx, 'hr-payroll', 'PAY');
      const run = await tx.hrPayrollRun.create({
        data: {
          number,
          fromDate,
          toDate,
          status: HrPayrollStatus.DRAFT,
          methodId: data.methodId || null,
          notes,
          createdById: data.createdById || null,
          totalNet: calc.totalNet,
          lines: {
            create: calc.lines.map((l) => ({
              employeeId: l.employeeId,
              presentDays: l.presentDays,
              paidLeaveDays: l.paidLeaveDays,
              permissionDays: l.permissionDays,
              absentDays: l.absentDays,
              daily: l.daily,
              hourlyRate: l.hourlyRate,
              overtimeHours: l.overtimeHours,
              overtimePay: l.overtimePay,
              lateHours: l.lateHours,
              earned: l.earned,
              bonuses: l.bonuses,
              deductions: l.deductions,
              advances: l.advances,
              latePenalty: l.latePenalty,
              permissionDeduct: l.permissionDeduct,
              salaryNet: l.salaryNet,
              salesTotal: l.salesTotal,
              commissionRate: l.commissionRate,
              commissionEarned: l.commissionEarned,
              commissionPaidBefore: l.commissionPaidBefore,
              commissionDue: l.commissionDue,
              net: l.net,
              detailJson: JSON.stringify({
                basic: l.basic,
                days: l.days,
                netToPay: l.netToPay,
                lateMinutes: l.lateMinutes,
                unpaidLeaveDays: l.unpaidLeaveDays,
                settingsSnapshot: l.settingsSnapshot,
              }),
            })),
          },
        },
        include: {
          lines: {
            include: { employee: { select: { id: true, code: true, name: true } } },
            orderBy: { employee: { code: 'asc' } },
          },
        },
      });

      const allMovementIds = calc.lines.flatMap((l) => l.movementIds);
      if (allMovementIds.length) {
        await tx.hrMovement.updateMany({
          where: { id: { in: allMovementIds }, payrollRunId: null },
          data: { payrollRunId: run.id },
        });
      }
      return this.hydrateRun(run);
    });
  }

  async deleteRun(id: string) {
    const run = await this.getRun(id);
    if (run.status !== HrPayrollStatus.DRAFT) {
      throw new BadRequestException('فقط المسودة قابلة للحذف');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.hrMovement.updateMany({
        where: { payrollRunId: id },
        data: { payrollRunId: null, settledAt: null },
      });
      await tx.hrPayrollLine.deleteMany({ where: { runId: id } });
      await tx.hrPayrollRun.delete({ where: { id } });
    });
    return { ok: true };
  }

  async postRun(id: string, data?: { methodId?: string }) {
    const run = await this.getRun(id);
    if (run.status === HrPayrollStatus.POSTED) {
      throw new BadRequestException('الكشف مرحّل مسبقاً');
    }
    if (run.totalNet <= 0) {
      throw new BadRequestException('لا يمكن ترحيل كشف بصافي ≤ صفر');
    }
    await assertPeriodsOpen(this.prisma, run.fromDate, run.toDate, new Date());

    const methodId = data?.methodId || run.methodId;
    if (!methodId) throw new BadRequestException('اختر طريقة دفع فورية مربوطة بخزنة');
    const method = await this.prisma.payMethod.findUnique({ where: { id: methodId } });
    if (!method || method.kind !== PayMethodKind.IMMEDIATE || !method.cashAccountId) {
      throw new BadRequestException('طريقة الدفع لازم تكون فورية ومربوطة بخزنة');
    }
    const account = await this.prisma.cashAccount.findUnique({ where: { id: method.cashAccountId } });
    if (!account) throw new NotFoundException('حساب الخزنة غير موجود');

    let category = await this.prisma.expenseCategory.findUnique({ where: { name: SALARY_EXPENSE_CATEGORY } });
    if (!category) {
      category = await this.prisma.expenseCategory.create({ data: { name: SALARY_EXPENSE_CATEGORY } });
    }

    const totalNet = roundMoney(run.totalNet);

    const posted = await this.prisma.$transaction(async (tx) => {
      await tx.cashAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: totalNet } },
      });
      await tx.cashTransaction.create({
        data: {
          accountId: account.id,
          direction: 'OUT',
          amount: totalNet,
          description: `صرف مرتبات ${run.number}`,
          paymentMethod: method.id,
          reference: run.number,
        },
      });
      const expense = await tx.expense.create({
        data: {
          categoryId: category!.id,
          accountId: account.id,
          amount: totalNet,
          expenseDate: new Date(),
          paymentMethod: method.id,
          notes: `كشف مرتبات ${run.number}`,
        },
      });

      await tx.hrMovement.updateMany({
        where: { payrollRunId: run.id },
        data: { settledAt: new Date() },
      });

      for (const line of run.lines) {
        if (line.commissionDue <= 0.009) continue;
        const comNumber = await nextSeq(tx, 'hr-commission', 'COM');
        await tx.hrCommissionPayment.create({
          data: {
            number: comNumber,
            employeeId: line.employeeId,
            fromDate: run.fromDate,
            toDate: run.toDate,
            amount: line.commissionDue,
            expenseId: expense.id,
            accountId: account.id,
            payrollRunId: run.id,
            notes: `ضمن صرف كشف المرتبات ${run.number}`,
          },
        });
      }

      return tx.hrPayrollRun.update({
        where: { id: run.id },
        data: {
          status: HrPayrollStatus.POSTED,
          methodId: method.id,
          accountId: account.id,
          expenseId: expense.id,
          postedAt: new Date(),
          totalNet,
        },
        include: {
          lines: {
            include: { employee: { select: { id: true, code: true, name: true } } },
            orderBy: { employee: { code: 'asc' } },
          },
          commissionPayments: true,
        },
      });
    });
    return this.hydrateRun(posted);
  }

  async commissionsExcel(from?: string, to?: string) {
    const report = await this.commissionsReport(from, to);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('عمولات');
    ws.columns = [
      { header: 'الكود', key: 'code', width: 12 },
      { header: 'الاسم', key: 'name', width: 24 },
      { header: 'نسبة %', key: 'commissionPercent', width: 10 },
      { header: 'المبيعات', key: 'salesTotal', width: 14 },
      { header: 'مستحق', key: 'commissionEarned', width: 14 },
      { header: 'مدفوع', key: 'commissionPaid', width: 14 },
      { header: 'متبقي', key: 'commissionRemaining', width: 14 },
    ];
    for (const row of report.rows) {
      ws.addRow({
        code: row.code,
        name: row.name,
        commissionPercent: row.commissionPercent,
        salesTotal: row.salesTotal,
        commissionEarned: row.commissionEarned,
        commissionPaid: row.commissionPaid,
        commissionRemaining: row.commissionRemaining,
      });
    }
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async nextEmployeeCode() {
    const last = await this.prisma.hrEmployee.findFirst({ orderBy: { createdAt: 'desc' }, select: { code: true } });
    const number = await nextSeq(this.prisma, 'hr-employee', 'EMP');
    return { code: number, suggested: last?.code || null };
  }

  async createEmployeeAccount(
    employeeId: string,
    data: { username?: string; password?: string; fullName?: string; role?: Role },
  ) {
    const emp = await this.getEmployee(employeeId);
    if (emp.userId) throw new BadRequestException('الموظف مربوط بحساب بالفعل');
    const username = (data.username || emp.code || `u${Date.now().toString(36)}`).trim().toLowerCase();
    const password = data.password || `${username}1234`;
    if (password.length < 4) throw new BadRequestException('كلمة السر 4 أحرف على الأقل');
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) throw new BadRequestException('اسم الدخول مستخدم');
    const role = data.role || Role.SALES;
    const access = normalizeAccess(null, role);
    access.hr = {
      view: true,
      actions: Array.from(new Set([...(access.hr?.actions || []), 'request'])),
      fields: access.hr?.fields?.length ? access.hr.fields : ['amounts'],
    };
    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: data.fullName?.trim() || emp.name,
        role,
        permissions: JSON.stringify(access),
      },
      select: { id: true, username: true, fullName: true, role: true },
    });
    const employee = await this.prisma.hrEmployee.update({
      where: { id: employeeId },
      data: { userId: user.id },
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
    });
    return { employee, user, temporaryPassword: data.password ? undefined : password };
  }

  async updateEmployeeAccount(employeeId: string, data: { userId?: string | null }) {
    return this.updateEmployee(employeeId, { userId: data.userId ?? null });
  }

  async recalculateLate(from?: string, to?: string) {
    const range = from && to
      ? parseRange(from, to)
      : parseRange(cairoYmd(new Date(Date.now() - 30 * 86400000)), cairoYmd(new Date()));
    const settings = await this.getSettings();
    const rows = await this.prisma.hrAttendance.findMany({
      where: {
        workDate: { gte: range.fromDate, lte: range.toDate },
        punchIn: { not: null },
      },
    });
    let updated = 0;
    for (const row of rows) {
      if (!row.punchIn) continue;
      const late = await this.computeLateMinutes(row.punchIn, settings);
      if (late !== row.lateMinutes) {
        await this.prisma.hrAttendance.update({
          where: { id: row.id },
          data: {
            lateMinutes: late,
            status: late > 0
              ? HrAttendanceStatus.LATE
              : row.status === HrAttendanceStatus.LATE
                ? HrAttendanceStatus.PRESENT
                : row.status,
          },
        });
        updated += 1;
      }
    }
    return { updated, from: range.fromYmd, to: range.toYmd };
  }

  private async computeLateMinutes(punchIn: Date, settings: HrSettings) {
    return this.calcLateMinutes(punchIn, punchIn, settings);
  }

  async listMissions(from?: string, to?: string, employeeId?: string) {
    const where: Prisma.HrAttendanceMissionWhereInput = {};
    if (employeeId) where.employeeId = employeeId;
    if (from && to) {
      const { fromDate, toDate } = parseRange(from, to);
      where.outAt = { gte: fromDate, lte: toDate };
    }
    return this.prisma.hrAttendanceMission.findMany({
      where,
      include: {
        employee: { select: { id: true, code: true, name: true } },
        attendance: { select: { id: true, workDate: true, punchIn: true, punchOut: true } },
      },
      orderBy: { outAt: 'desc' },
    });
  }

  async missionOut(employeeId: string, at?: string, notes?: string) {
    const when = at ? new Date(at) : new Date();
    const ymd = cairoYmd(when);
    const attendance = await this.prisma.hrAttendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: dateOnly(ymd) } },
    });
    if (!attendance?.punchIn) throw new BadRequestException('سجّل الحضور أولاً قبل خروج المأمورية');
    if (attendance.punchOut) throw new BadRequestException('تم الانصراف بالفعل — لا يمكن فتح مأمورية');
    const open = await this.prisma.hrAttendanceMission.findFirst({
      where: { attendanceId: attendance.id, inAt: null },
    });
    if (open) throw new BadRequestException('يوجد مأمورية مفتوحة بالفعل');
    return this.prisma.hrAttendanceMission.create({
      data: {
        attendanceId: attendance.id,
        employeeId,
        outAt: when,
        notes: notes?.trim() || null,
      },
    });
  }

  async missionIn(employeeId: string, at?: string) {
    const when = at ? new Date(at) : new Date();
    const open = await this.prisma.hrAttendanceMission.findFirst({
      where: { employeeId, inAt: null },
      orderBy: { outAt: 'desc' },
    });
    if (!open) throw new BadRequestException('لا توجد مأمورية مفتوحة');
    return this.prisma.hrAttendanceMission.update({
      where: { id: open.id },
      data: { inAt: when },
    });
  }

  async deleteMission(id: string) {
    await this.prisma.hrAttendanceMission.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('المأمورية غير موجودة');
    });
    return { ok: true };
  }

  async punchOutGuarded(employeeId: string, at?: string) {
    const open = await this.prisma.hrAttendanceMission.findFirst({
      where: { employeeId, inAt: null },
    });
    if (open) throw new BadRequestException('لا يمكن الانصراف أثناء مأمورية مفتوحة — سجّل الرجوع أولاً');
    return this.punchOut(employeeId, at);
  }

  async payrollCovered(from: string, to: string) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(from, to);
    const employees = await this.prisma.hrEmployee.findMany({ where: { isActive: true }, select: { id: true } });
    const covered = await this.findCoveredEmployees(employees.map((e) => e.id), fromDate, toDate);
    return {
      from: fromYmd,
      to: toYmd,
      covered: [...covered.entries()].map(([employeeId, info]) => ({ employeeId, ...info })),
    };
  }

  async payrollPayments(from?: string, to?: string) {
    const where: Prisma.HrPayrollRunWhereInput = { status: HrPayrollStatus.POSTED };
    if (from && to) {
      const { fromDate, toDate } = parseRange(from, to);
      where.fromDate = { lte: toDate };
      where.toDate = { gte: fromDate };
    }
    return this.prisma.hrPayrollRun.findMany({
      where,
      include: {
        _count: { select: { lines: true, commissionPayments: true } },
      },
      orderBy: { postedAt: 'desc' },
    });
  }

  async me(userId: string) {
    const employee = await this.prisma.hrEmployee.findFirst({
      where: { userId, isActive: true },
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
    });
    if (!employee) throw new NotFoundException('لا توجد بطاقة موظف مربوطة بحسابك');
    return employee;
  }

  async listRequests(userId: string, role: Role, mine?: boolean) {
    const isAdmin = role === Role.ADMIN || role === Role.ACCOUNTANT;
    if (!isAdmin || mine) {
      const emp = await this.prisma.hrEmployee.findFirst({ where: { userId } });
      if (!emp) return [];
      return this.prisma.hrRequest.findMany({
        where: { employeeId: emp.id },
        include: { employee: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.hrRequest.findMany({
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRequest(
    userId: string,
    data: {
      type: HrRequestType;
      fromDate?: string;
      toDate?: string;
      hours?: number;
      amount?: number;
      notes?: string;
      employeeId?: string;
    },
  ) {
    let employeeId = data.employeeId;
    if (!employeeId) {
      const emp = await this.prisma.hrEmployee.findFirst({ where: { userId, isActive: true } });
      if (!emp) throw new BadRequestException('اربط حسابك ببطاقة موظف أولاً');
      employeeId = emp.id;
    }
    if (data.type === HrRequestType.LEAVE_ANNUAL || data.type === HrRequestType.LEAVE_PERMISSION) {
      if (!data.fromDate || !data.toDate) throw new BadRequestException('حدد تاريخ البداية والنهاية');
    }
    if (data.type === HrRequestType.LEAVE_PERMISSION && !(Number(data.hours) > 0)) {
      throw new BadRequestException('حدد عدد ساعات الإذن');
    }
    const moneyTypes: HrRequestType[] = [
      HrRequestType.ADVANCE,
      HrRequestType.BONUS,
      HrRequestType.DEDUCTION,
      HrRequestType.LATE,
    ];
    if (moneyTypes.includes(data.type) && !(Number(data.amount) > 0)) {
      throw new BadRequestException('حدد المبلغ');
    }
    return this.prisma.hrRequest.create({
      data: {
        employeeId,
        type: data.type,
        status: HrRequestStatus.PENDING,
        fromDate: data.fromDate ? dateOnly(data.fromDate) : null,
        toDate: data.toDate ? dateOnly(data.toDate) : null,
        hours: Number(data.hours) > 0 ? Number(data.hours) : null,
        amount: Number(data.amount) > 0 ? Number(data.amount) : null,
        notes: data.notes?.trim() || null,
        createdById: userId,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async cancelRequest(id: string, userId: string, role: Role) {
    const row = await this.prisma.hrRequest.findUnique({ where: { id }, include: { employee: true } });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== HrRequestStatus.PENDING) throw new BadRequestException('لا يمكن إلغاء طلب غير معلّق');
    const isAdmin = role === Role.ADMIN || role === Role.ACCOUNTANT;
    if (!isAdmin && row.employee.userId !== userId && row.createdById !== userId) {
      throw new BadRequestException('ليس لديك صلاحية إلغاء هذا الطلب');
    }
    return this.prisma.hrRequest.update({
      where: { id },
      data: { status: HrRequestStatus.CANCELLED },
    });
  }

  async approveRequest(
    id: string,
    reviewerId: string,
    opts?: { reviewNotes?: string; hours?: number; amount?: number },
  ) {
    const row = await this.prisma.hrRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== HrRequestStatus.PENDING) throw new BadRequestException('الطلب ليس معلّقاً');
    const approvedHours = opts?.hours != null && Number(opts.hours) > 0 ? Number(opts.hours) : row.hours;
    const approvedAmount = opts?.amount != null && Number(opts.amount) > 0 ? Number(opts.amount) : row.amount;

    if (row.type === HrRequestType.LEAVE_ANNUAL || row.type === HrRequestType.LEAVE_PERMISSION) {
      if (!row.fromDate || !row.toDate) throw new BadRequestException('تواريخ الإجازة ناقصة');
      const kind = row.type === HrRequestType.LEAVE_ANNUAL ? HrLeaveKind.ANNUAL : HrLeaveKind.PERMISSION;
      await this.prisma.hrLeave.create({
        data: {
          employeeId: row.employeeId,
          fromDate: row.fromDate,
          toDate: row.toDate,
          kind,
          status: HrLeaveStatus.APPROVED,
          hours: kind === HrLeaveKind.PERMISSION ? approvedHours : null,
          notes: row.notes,
        },
      });
      if (row.type === HrRequestType.LEAVE_PERMISSION && approvedHours && approvedHours > 0) {
        const settings = await this.getSettings();
        const amount = settings.permissionDeductPerHour > 0
          ? roundMoney(approvedHours * settings.permissionDeductPerHour)
          : 0;
        if (amount > 0) {
          await this.prisma.hrMovement.create({
            data: {
              employeeId: row.employeeId,
              kind: HrMovementKind.PERMISSION,
              amount,
              movementDate: row.fromDate,
              notes: `إذن ${approvedHours} ساعة من طلب ${row.id.slice(-6)}`,
            },
          });
        }
      }
    } else {
      const kindMap: Record<string, HrMovementKind> = {
        ADVANCE: HrMovementKind.ADVANCE,
        BONUS: HrMovementKind.BONUS,
        DEDUCTION: HrMovementKind.DEDUCTION,
        LATE: HrMovementKind.LATE,
      };
      const kind = kindMap[row.type];
      if (!kind || !(approvedAmount && approvedAmount > 0)) throw new BadRequestException('بيانات الحركة ناقصة');
      await this.prisma.hrMovement.create({
        data: {
          employeeId: row.employeeId,
          kind,
          amount: approvedAmount,
          movementDate: row.fromDate || dateOnly(new Date()),
          notes: row.notes || `من طلب ${row.type}`,
        },
      });
    }

    return this.prisma.hrRequest.update({
      where: { id },
      data: {
        status: HrRequestStatus.APPROVED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: opts?.reviewNotes?.trim()
          || (approvedHours != null && approvedHours !== row.hours ? `اعتماد ${approvedHours} ساعة` : null),
        hours: row.type === HrRequestType.LEAVE_PERMISSION ? approvedHours : row.hours,
        amount: approvedAmount,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async rejectRequest(id: string, reviewerId: string, reviewNotes?: string) {
    const row = await this.prisma.hrRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== HrRequestStatus.PENDING) throw new BadRequestException('الطلب ليس معلّقاً');
    return this.prisma.hrRequest.update({
      where: { id },
      data: {
        status: HrRequestStatus.REJECTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes?.trim() || 'مرفوض',
      },
    });
  }
}
