# Regras

As regras do Severino em detalhe. O resumo está no [README](../README.md).

| Regra | Como funciona |
| --- | --- |
| XP | 5 a 15 por mensagem, no máximo uma vez por minuto por pessoa, e 1 por minuto em call. |
| Voz | Conta quem está em call com pelo menos mais uma pessoa ouvindo. Não contam o canal AFK, quem está ensurdecido nem quem está sozinho. Microfone mudo conta. |
| Nível | Nível 2 aos 100 XP, 3 aos 400, 4 aos 900 (`100 × (nível − 1)²`). |
| Daily | 100 moedas, automático na primeira atividade do dia (mensagem, entrada em call ou minuto de voz). O dia vira à meia-noite de Brasília. |
| Moedas | Por enquanto só aparecem no perfil. Todo lançamento fica no livro-caixa (`CoinTransaction`). |
| Ranking | Geral (XP total) e semanal (desde segunda, 0h de Brasília). Só membros atuais, sem bots e com pontos. |
| Música | `/musica` toca áudio do YouTube, por link de vídeo ou busca, para quem tem algum cargo além do @everyone; administradores e donos do aplicativo sempre podem. Faixas de até 30 minutos e até 50 na fila, sem playlists nem transmissões ao vivo. O bot sai depois de 5 minutos sem nada na fila ou de 2 minutos sozinho no canal. A fila fica em memória e some quando o bot reinicia. Músicas já tocadas ficam guardadas por 7 dias e tocam de novo sem passar pelo YouTube. |
| Salas | Entrar num hub cria uma sala com o nome do modelo (padrão `Quarto de {user}`). Uma sala por pessoa, 30 s entre criações, apagada quando fica sem ninguém. Só canais criados pelo bot são apagados. |
| Dados | Os dados dos membros são guardados sem prazo; quem sai fica marcado como fora do servidor. |

## Player da música

A cada faixa, o bot publica um player no canal de texto do pedido, com a capa, quem pediu, a próxima da fila e os botões ⏸️ Pausar (ou ▶️ Continuar), ⏭️ Pular, ⏹️ Parar e 📜 Fila. Os botões seguem as regras dos comandos: a fila é livre, e o resto pede cargo e estar no canal do bot. O player da faixa anterior é apagado, para o atual ficar no fim do canal; quando o bot sai do canal, o player vira o aviso de saída, sem botões.

## Registro

Toda ação de `/admin` e `/limpar` fica registrada em `AuditLog`. Os donos do aplicativo no Developer Portal também podem usar o `/admin`.
