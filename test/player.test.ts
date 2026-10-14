import { describe, expect, it } from 'vitest';
import { parsePlayerButton, renderEnded, renderPlayer, renderQueue, type PlayerView } from '../src/lib/music/player.js';
import type { Track } from '../src/lib/music/queue.js';

const track = (id: string, title: string, durationSeconds: number | null = 213): Track => ({
	id,
	title,
	url: `https://www.youtube.com/watch?v=${id}`,
	durationSeconds,
	channel: 'Rick_Astley',
	requestedBy: '222222222222222222'
});
const atual = track('dQw4w9WgXcQ', 'Never Gonna Give You Up');
const view = (extra: Partial<PlayerView> = {}): PlayerView => ({
	track: atual,
	paused: false,
	voiceChannelId: '333333333333333333',
	queue: [],
	queueSize: 0,
	queueSeconds: 0,
	...extra
});
const buttonIds = (rendered: ReturnType<typeof renderPlayer>) =>
	rendered.components.flatMap((row) => row.toJSON().components.map((button) => ('custom_id' in button ? button.custom_id : null)));

describe('botões do player', () => {
	it('reconhece só os botões da música', () => {
		expect(parsePlayerButton('musica:pausar')).toBe('pausar');
		expect(parsePlayerButton('musica:fila')).toBe('fila');
		expect(parsePlayerButton('musica:apagar-tudo')).toBeNull();
		expect(parsePlayerButton('ranking:pular')).toBeNull();
	});
});

describe('mensagem do player', () => {
	it('mostra a faixa atual, a capa, quem pediu, o canal e os botões', () => {
		const rendered = renderPlayer(view({ queue: [track('9bZkp7q19f0', 'Gangnam *Style*', 252)], queueSize: 1, queueSeconds: 252 }));
		const embed = rendered.embeds[0].toJSON();
		expect(embed.author?.name).toBe('▶️ Tocando agora');
		expect(embed.title).toBe('Never Gonna Give You Up');
		expect(embed.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(embed.thumbnail?.url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
		expect(embed.description).toBe('Rick\\_Astley');
		expect(embed.fields).toEqual([
			{ name: 'Duração', value: '3:33', inline: true },
			{ name: 'Pedida por', value: '<@222222222222222222>', inline: true },
			{ name: 'Canal', value: '<#333333333333333333>', inline: true },
			{ name: 'Próxima', value: '**Gangnam \\*Style\\*** · 4:12' }
		]);
		expect(embed.footer?.text).toBe('1 na fila · 4:12');
		expect(buttonIds(rendered)).toEqual(['musica:pausar', 'musica:pular', 'musica:parar', 'musica:fila']);
	});

	it('troca Pausar por Continuar quando pausado', () => {
		const rendered = renderPlayer(view({ paused: true }));
		expect(rendered.embeds[0].toJSON().author?.name).toBe('⏸️ Pausado');
		expect(buttonIds(rendered)).toEqual(['musica:continuar', 'musica:pular', 'musica:parar', 'musica:fila']);
		expect(rendered.embeds[0].toJSON().fields?.at(-1)).toEqual({ name: 'Próxima', value: 'Nada na fila.' });
	});

	it('com a fila vazia, só deixa o Parar', () => {
		const rendered = renderPlayer(view({ track: null }));
		expect(rendered.embeds[0].toJSON().author?.name).toBe('⏹️ Fila vazia');
		expect(buttonIds(rendered)).toEqual(['musica:parar']);
	});

	it('vira o aviso de saída, sem botões', () => {
		const rendered = renderEnded('👋 Saí do canal: fiquei sozinho.');
		expect(rendered.embeds[0].toJSON().description).toBe('👋 Saí do canal: fiquei sozinho.');
		expect(rendered.components).toEqual([]);
	});
});

describe('fila', () => {
	it('mostra a atual, as próximas 10 e quantas sobram', () => {
		const queue = Array.from({ length: 12 }, (_, index) => track('dQw4w9WgXcQ', `Faixa ${index + 1}`, 60));
		const embed = renderQueue({ ...view({ queue, queueSize: 12, queueSeconds: 720 }), track: atual }).toJSON();
		const lines = embed.description!.split('\n');
		expect(lines[0]).toBe('▶️ **Tocando agora:** **Never Gonna Give You Up** · 3:33 · <@222222222222222222>');
		expect(lines[2]).toBe('**1.** **Faixa 1** · 1:00 · <@222222222222222222>');
		expect(lines).toContain('… e mais 2');
		expect(lines.filter((line) => line.startsWith('**'))).toHaveLength(10);
		expect(embed.footer?.text).toBe('13 música(s) · 15:33 no total');
	});
});
