import bcrypt from 'bcryptjs';
import { prisma } from './client';

async function main() {
  const existingUserCount = await prisma.user.count();

  if (existingUserCount === 0) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME?.trim() || 'Super Admin';

    if (!email || !password) {
      throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required when creating the first user');
    }
    if (password.length < 12) {
      throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'SUPER_ADMIN'
      }
    });
    console.log('Created initial super admin user');
  } else {
    console.log('Admin user already exists; skipped account seeding');
  }

  const defaults = {
    captureSpeedMs: 1500,
    maxConcurrentStreams: 8,
    retentionDays: 365,
    pdfBrandName: 'YouTube Live Chat Intelligence',
    pdfBrandAccent: '#2563eb',
    timezone: 'Asia/Karachi'
  };

  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: key === 'timezone' ? { value } : {},
      create: { key, value }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
