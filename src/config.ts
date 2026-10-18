import 'dotenv/config';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'precisa ser um ID do Discord');
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const schema = z.object({
	DISCORD_TOKEN: z.string().min(50, 'token do bot ausente ou curto demais'),
	GUILD_ID: snowflake,
	HUB_CHANNEL_ID: z.preprocess(emptyToUndefined, snowflake.optional()),
	DATABASE_URL: z.string().startsWith('postgresql://', 'precisa ser uma URL postgresql://'),
	AUTO_SYNC_MEMBERS: z
		.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('true'))
		.transform((value) => value === 'true'),
	HEALTH_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65_535).default(8080)),
	// Fora do Docker valem o yt-dlp e o ffmpeg do PATH; a imagem define o caminho do seu yt-dlp
	YTDLP_PATH: z.preprocess(emptyToUndefined, z.string().default('yt-dlp')),
	// yt-dlp só pelo IPv6; o Docker liga, porque o Google marcou o IPv4 de casa em 17/10/2026
	YTDLP_FORCE_IPV6: z
		.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false'))
		.transform((value) => value === 'true'),
	// Cache em disco da música (áudio e pedidos); vazio desliga
	MUSIC_CACHE_DIR: z.preprocess(emptyToUndefined, z.string().optional())
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
	// As mensagens citam só o nome da variável, nunca o valor
	const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
	console.error(`Configuração inválida; confira as variáveis de ambiente:\n${problems}`);
	process.exit(1);
}

export const config = parsed.data;
