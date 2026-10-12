import { prisma } from './prisma.js';

/** Registra uma ação administrativa: quem fez, o quê, em quem e com quais detalhes. */
export async function audit(actorId: string, action: string, targetId: string | null, details?: string): Promise<void> {
	await prisma.auditLog.create({ data: { actorId, action, targetId, details } });
}
