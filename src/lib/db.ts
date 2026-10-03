import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // full query logging is a dev aid — production lambdas log volumes/costs
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query"],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db