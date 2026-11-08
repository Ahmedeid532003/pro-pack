import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { PrismaService } from '../prisma/prisma.service';

export const DELETE_PASSWORD_KEY = 'deletePasswordHash';
export const DELETE_PASSWORD_HEADER = 'x-delete-password';

/** Invoice deletion always needs the delete password set in settings; the client sends it URI-encoded. */
export async function assertDeletePassword(prisma: PrismaService, encoded?: string) {
  const row = await prisma.setting.findUnique({ where: { key: DELETE_PASSWORD_KEY } });
  if (!row?.value) {
    throw new BadRequestException('حذف الفواتير محتاج كلمة سر — عيّنها الأول من الإعدادات');
  }
  let password = '';
  try {
    password = decodeURIComponent(encoded || '');
  } catch {
    password = '';
  }
  if (!password || !(await bcrypt.compare(password, row.value))) {
    throw new ForbiddenException('كلمة سر الحذف غير صحيحة');
  }
}
