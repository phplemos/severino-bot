import { Listener, ChatInputCommandErrorPayload } from '@sapphire/framework';

export class ChatInputCommandErrorListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'chatInputCommandError'
		});
	}

	public run(error: unknown, payload: ChatInputCommandErrorPayload) {
		this.container.logger.error(`Error in command ${payload.command.name}:`, error);
	}
}
